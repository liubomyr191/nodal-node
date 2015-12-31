module.exports = (function() {

  'use strict';

  const ModelArray = require('../model_array.js');
  const utilities = require('../utilities.js');

  class Composer {

    constructor(db, modelConstructor, query) {

      this._db = db;
      this._modelConstructor = modelConstructor;
      this._modelTable = modelConstructor.table();
      this._modelColumns = modelConstructor.columnNames();
      this._modelColumnLookup = modelConstructor.columnLookup();
      this._modelJoinsLookup = Object.assign({}, modelConstructor.prototype._joins);

      this._query = (query instanceof Array ? query : []).slice();

      this._filters = [];
      this._columns = this._query.length ? this._query[this._query.length - 1]._columns.slice() : this._modelColumns.slice();
      this._orderBy = [];
      this._groupBy = null;
      this._joinArray = [];

      this._joinedAlias = {};
      this._joined = {};
      this._transformations = {};

      this._count = 0;
      this._offset = 0;

    }

    __aggregateOrder__() {

      let modelConstructor = this._modelConstructor;
      let db = this._db;

      if (this._orderBy.length && this._groupBy) {
        this._orderBy.filter(order => !order.format).forEach((order, i) => {
          order.format = db.adapter.aggregate(
            modelConstructor.prototype.aggregateBy[order.columnName]
          );
        });
      }

    }

    __parseFilters__(filterObj) {

      let comparators = this._db.adapter.comparators;
      let columnLookup = this._modelColumnLookup;
      let relationshipLookup = this._modelJoinsLookup;

      filterObj.hasOwnProperty('__order') &&
        this.orderBy.call(this, filterObj.__order.split(' ')[0], filterObj.__order.split(' ')[1]);

      filterObj.hasOwnProperty('__offset') || filterObj.hasOwnProperty('__count') &&
        this.limit(filterObj.__offset || 0, filterObj.__count || 0);

      Object.keys(filterObj)
        .filter(filter => relationshipLookup[filter])
        .forEach(filter => {
          let rel = relationshipLookup[filter];
          filterObj[rel.via] = filterObj[filter].get('id');
          delete filterObj[filter];
        });

      return Object.keys(filterObj)
        .map(filter => {

          let column = filter.split('__');
          let table = null;
          let rel = relationshipLookup[column[0]];

          if (rel) {

            let joinName = column.shift();

            // if it's not found, return null...
            if (!rel.model.columnNames().filter(c => c === column[0]).length) {
              return null;
            }

            let foundQuery = this._query.filter(q => q.hasJoined(joinName)).pop();

            if (foundQuery) {
              column[0] = foundQuery.getJoinedAlias(joinName, column[0]);
            } else {
              table = rel.model.prototype.schema.table;
            }

          }

          let comparator = column.length > 1 ? column.pop() : 'is';
          let columnName = column.join('__');

          // block out bad column names
          if (!rel && !columnLookup[columnName]) {
            return null;
          }

          if (!comparators[comparator]) {
            return null;
          }

          return {
            table: table,
            columnName: columnName,
            comparator: comparator,
            value: filterObj[filter],
          };

        })
        .filter(v => {
          return !!v;
        });

    }

    __prepareAggregateBy__(table, columns) {

      let modelConstructor = this._modelConstructor;
      let relationships = modelConstructor.prototype._joins;

      let aggregateBy = {};
      aggregateBy[table] = {};

      columns.filter(c => typeof c === 'string')
        .forEach(c => aggregateBy[table][c] = modelConstructor.prototype.aggregateBy[c]);

      columns.filter(c => c.transform)
        .forEach(c => {
          c.columns.forEach(c => aggregateBy[table][c] = modelConstructor.prototype.aggregateBy[c]);
        })

      columns.filter(c => c.relationship)
        .forEach(c => {
          aggregateBy[c.table] = aggregateBy[c.table] || {};
          aggregateBy[c.table][c.column] = relationships[c.relationship].model.prototype.aggregateBy[c.column];
        });

      return aggregateBy;

    }

    __prepareColumns__(columns) {

      return columns.map(c => this._joinedAlias[c] || c);

    };

    __toSQL__(table, columns, sql, paramOffset) {

      let base = !table;

      let db = this._db;

      let modelConstructor = this._modelConstructor;

      table = table || this._modelTable;
      columns = this.__prepareColumns__(columns);
      // console.log('COLUMNS');
      // console.log(table);
      // console.log(columns);
      let multiFilter = db.adapter.createMultiFilter(table, this._filters);
      let params = db.adapter.getParamsFromMultiFilter(multiFilter);

      return {
        sql: db.adapter.generateSelectQuery(
          base ? null : sql,
          table,
          columns,
          multiFilter,
          this._joinArray,
          this._groupBy,
          this.__prepareAggregateBy__(table, columns),
          this._orderBy,
          {count: this._count, offset: this._offset},
          paramOffset
        ),
        params: params
      };

    }

    __prepareQuery__(isSummary) {

      let query = this._query.slice();
      query.push(this);

      let queryCount = query.length;

      let genTable = i => `t${i}`;
      let grouped = !!query.filter(q => q._groupBy).length;

      let returnModels = !grouped; // FIXME: Maybe?

      let preparedQuery = query.reduce((prev, query, i) => {
        // If it's a summary, convert the last query to an aggregate query.
        query = ((i === queryCount - 1) && isSummary) ? query.aggregate() : query;
        let select = query.__toSQL__(
          i && genTable(i),
          query._columns, // change this to change which columns load
          prev.sql,
          prev.params.length
        );
        return {
          sql: select.sql,
          params: prev.params.concat(select.params)
        }
      }, {params: []});

      preparedQuery.grouped = grouped;
      preparedQuery.models = returnModels;
      preparedQuery.columns = this._columns; // TODO: Deprecate?

      return preparedQuery;

    }

    __query__(pQuery, callback) {

      this._db.query(
        pQuery.sql,
        pQuery.params,
        callback
      );

      return this;

    }

    copy() {

      let copy = new Composer(this._db, this._modelConstructor, this._query);

      Object.keys(this).forEach(k => copy[k] = this[k] instanceof Array ? this[k].slice() : this[k]);

      return copy;

    }

    aggregate() {

      let copy = this.copy();
      copy._groupBy = [];
      copy._orderBy = [];

      return copy;

    }

    __parseColumns__(columns) {

      let relationships = {};
      let tables = [];

      columns = columns.map((c, i) => {

        let colSplit = c.split('__');
        let colRelationshipName = colSplit.length > 1 ? colSplit.shift() : null;
        let colName = colSplit.join('__');

        if (colRelationshipName) {

          let rel = (
            relationships[colRelationshipName] = relationships[colRelationshipName] ||
              this.__getRelationship__(colRelationshipName)
          );

          if (!rel) {
            throw new Error(`Model has no relationship "${colRelationshipName}"`);
          }

          if (!rel.model.prototype.schema.columns.filter(c => c.name === colName).length) {
            throw new Error(`Model relationship "${colRelationshipName}" has no column "${colName}"`);
          }

          tables.push(rel.model.prototype.schema.table);

        } else {

          if (!this._modelColumnLookup[colName]) {
            throw new Error(`Model has no column "${colName}"`);
          }

          tables.push(null);

        }

        return colName;

      });

      return {
        tables: tables,
        columns: columns
      };

    }

    transform(alias, transformFn, type, isArray, useAggregate) {

      if (typeof transformFn === 'string') {
        transformFn = new Function(transformFn, `return ${transformFn};`);
      }

      if (typeof transformFn !== 'function') {
        throw new Error('.transform requires valid transformation function');
      }

      let columns = utilities.getFunctionParameters(transformFn);

      let parsedColumns = this.__parseColumns__(columns);

      this._transformations[alias] = {
        alias: alias,
        tables: parsedColumns.tables,
        columns: parsedColumns.columns,
        transform: transformFn,
        type: type,
        array: isArray,
        useAggregate: !!useAggregate
      };

      return this;

    }

    stransform(alias, transformFn, type, isArray) {

      return this.transform(alias, transformFn, type, isArray, true);

    }

    filter(filters) {

      if (this._filters.length) {
        this._query.push(this);
        let child = new Composer(this._db, this._modelConstructor, this._query);
        return child.filter.apply(child, arguments);
      }

      if (!(filters instanceof Array)) {
        filters = [].slice.call(arguments);
      }

      this._filters = filters.map(
        this.__parseFilters__.bind(this)
      ).filter(f => f.length);

      return this;

    }

    getJoinedAlias(joinName, column) {
      let joinsObject = this._joined[joinName];
      return `${(joinsObject.child && joinsObject.multiple) ? '$$' : '$'}${joinName}\$${column}`;
    }

    setJoined(joinName) {

      let joins = this._modelConstructor.prototype._joins;

      let joinsObject = Object.keys(joins)
        .filter(name => name === joinName)
        .map(name => joins[name])
        .pop();

      if (!joinsObject) {
        throw new Error(`Model "${this._modelConstructor.name}" has no join "${joinName}. Valid joins are "${Object.keys(joins).map(j => j + '", "')}".`);
      }

      return (this._joined[joinName] = joinsObject);

    }

    hasJoined(joinName) {
      return !!this._joined[joinName];
    }

    join(joinName, columns) {

      let joinsObject = this.setJoined(joinName);

      this._joinArray.push({
        table: joinsObject.model.prototype.schema.table,
        field: joinsObject.child ? joinsObject.via : 'id',
        baseField: joinsObject.child ? 'id' : joinsObject.via
      });

      let columnLookup = joinsObject.model.columnLookup();
      let columnNames = joinsObject.model.columnNames();

      columnNames.forEach(columnName => {

        let alias = this.getJoinedAlias(joinName, columnName);

        this._joinedAlias[alias] = {
          table: joinsObject.model.prototype.schema.table,
          relationship: joinName,
          alias: alias,
          column: columnName,
          type: columnLookup[columnName].type
        };

        this._columns.push(alias);

      });

      // FIXME: Must order by parent table id for parser to work
      // We should fix this in the parser...
      let orderBy;
      for (let i = 0; i < this._orderBy.length; i++) {
        if (this._orderBy[i].columnName === 'id') {
          orderBy = this._orderBy.splice(i, 1)[0];
          break;
        }
      }

      if (!orderBy) {
        orderBy = {columnName: 'id', direction: 'ASC', format: null}
      }

      this._orderBy.unshift(orderBy);

      return this;

    }

    orderBy(field, direction, formatFunc) {

      if (this._groupBy && !this._groupBy.length) {
        throw new Error('Can not call .orderBy on a standalone aggregate query');
      }

      if (!this._modelColumnLookup[field]) {
        return this;
      }

      if (typeof formatFunc !== 'function') {
        formatFunc = null;
      }

      this._orderBy.push({
        columnName: field,
        direction: ({'asc': 'ASC', 'desc': 'DESC'}[(direction + '').toLowerCase()] || 'ASC'),
        format: formatFunc
      });

      this.__aggregateOrder__();

      return this;

    }

    __getRelationship__(field) {

      if (!field) {
        return undefined;
      }

      let relationships = this._modelConstructor.prototype._joins;
      return Object.keys(relationships)
        .filter(name => name === field)
        .map(name => relationships[name])
        .pop();

    }

    groupByRelationship(rel) {

      let table = rel.model.prototype.schema.table;
      this._groupBy = (this._groupBy || []).concat(
        rel.model.prototype.schema.columns.map(c => {
          return {
            tables: [table],
            columns: [c.name],
            format: null
          };
        })
      );

      this.__aggregateOrder__();

      return this;

    }

    groupBy(columns, formatFunc) {

      if (typeof columns === 'function') {

        formatFunc = columns;
        columns = utilities.getFunctionParameters(formatFunc);

      } else {

        if (typeof columns === 'string') {

          let rel = this.__getRelationship__(columns);
          if (rel) {
            return this.groupByRelationship(rel);
          }

          columns = [columns];

        }

      }

      let parsedColumns = this.__parseColumns__(columns);

      if (typeof formatFunc !== 'function') {
        formatFunc = null;
      }

      this._groupBy = this._groupBy || [];

      this._groupBy.push({
        tables: parsedColumns.tables,
        columns: parsedColumns.columns,
        format: formatFunc
      });

      this.__aggregateOrder__();

      return this;

    }

    limit(offset, count) {

      if (count === undefined) {
        count = offset;
        offset = 0;
      }

      count = parseInt(count);
      offset = parseInt(offset);

      this._count = this._count ? Math.min(count, this._count) : Math.max(count, 0);
      this._offset += offset;

      return this;

    }

    update(fields, callback) {

      this.interface('id');

      let db = this._db;
      let modelConstructor = this._modelConstructor;
      let pQuery = this.__prepareQuery__();

      let columns = Object.keys(fields);
      let params = columns.map(c => fields[c]);

      pQuery.sql = db.adapter.generateUpdateAllQuery(
        modelConstructor.prototype.schema.table,
        'id',
        columns,
        pQuery.params.length,
        pQuery.sql
      );

      pQuery.params = pQuery.params.concat(params);

      this.__query__(
        pQuery,
        (err, result) => {

          let rows = result ? (result.rows || []).slice() : [];

          let models = new ModelArray(modelConstructor);
          models.push.apply(models, rows.map(r => new modelConstructor(r, true)));

          callback.call(this, err, models);

        }
      )

    }

    __parseModelsFromRows__(rows) {

      // console.log('START PARSE', rows.length);

      let s = new Date().valueOf();

      let modelConstructor = this._modelConstructor;
      let models = new ModelArray(modelConstructor);

      let rowKeys = [];
      rows.length && (rowKeys = Object.keys(rows[0]));

      // First, grab all the keys and multiple keys we need...
      let joinKeys = rowKeys.filter(key => key[0] === '$' && key[1] !== '$');
      let joinMultipleKeys = rowKeys.filter(key => key[0] === '$' && key[1] === '$');

      // Next, create lookup for main / sub keys from our keys
      let createLookup = (multiple) => {

        let offset = multiple ? 2 : 1;

        return (lookup, key) => {

          let index = key.indexOf('$', offset);

          if (index === -1) {
            return;
          }

          let mainKey = key.substr(offset, index - offset);
          let subKey = key.substr(index + 1);

          lookup[key] = {
            mainKey: mainKey,
            subKey: subKey,
            multiple: multiple
          };

          return lookup;

        }

      };

      // create a lookup for any field
      let joinLookup = joinMultipleKeys.reduce(
        createLookup(true),
        joinKeys.reduce(createLookup(false), {})
      );

      // create a skeleton object to temporarily hold model data
      let joinSkeleton = Object.keys(joinLookup).reduce((obj, key) => {

        let lookup = joinLookup[key];

        obj[lookup.mainKey] = obj[lookup.mainKey] || {
          data: {},
          multiple: lookup.multiple
        };

        obj[lookup.mainKey].data[lookup.subKey] = null;

        return obj;

      }, {});

      // Get our names for joined or joined multiple fields
      let joinNames = Object.keys(joinSkeleton).filter(j => !joinSkeleton[j].multiple);
      let joinMultipleNames = Object.keys(joinSkeleton).filter(j => joinSkeleton[j].multiple);

      // Assign to skeleton function for copying data to our schema
      let assignToSkeleton = (row) => {

        return (key) => {

          let keySplit = joinLookup[key];
          joinSkeleton[keySplit.mainKey].data[keySplit.subKey] = row[key];

        };

      };

      rows = rows.reduce((newRows, row) => {

        let lastRow = newRows[newRows.length - 1];
        let curRow = row;

        if (lastRow && lastRow.id === row.id) {

          curRow = lastRow;

        } else {

          // if it's a new row, we need to fill the skeleton with new data and create
          // a new model
          joinKeys.forEach(assignToSkeleton(row));
          joinNames.forEach(joinName => {

            row[joinName] = new this._modelJoinsLookup[joinName].model(
              joinSkeleton[joinName].data,
              true
            );

          });

          newRows.push(row);

        }

        // if the lowest common denominator (right now) is a multiple joined field
        // so it will be new on every row
        joinMultipleKeys.forEach(assignToSkeleton(row));
        joinMultipleNames.forEach(joinName => {

          let joinModelConstructor = this._modelJoinsLookup[joinName].model;

          curRow[joinName] = curRow[joinName] || new ModelArray(joinModelConstructor);
          curRow[joinName].push(
            new joinModelConstructor(
              joinSkeleton[joinName].data,
              true
            )
          );

        });

        return newRows;

      }, []).forEach(row => {

        models.push(new modelConstructor(row));

      });

      // console.log('END PARSE', new Date().valueOf() - s);

      return models;

    }

    end(callback, summary) {

      let modelConstructor = this._modelConstructor;

      let pQuery = this.__prepareQuery__();

      this.__query__(
        pQuery,
        (err, result) => {

          let rows = result ? (result.rows || []).slice() : [];
          let models;

          if (pQuery.models) {

            models = this.__parseModelsFromRows__(rows);

          }

          callback.call(this, err, models);

        }
      );

      return this;

    }

    summarize(callback) {

      let pQuery = this.__prepareQuery__(true);

      this.__query__(
        pQuery,
        (err, result) => {

          this.end(callback, !err && result.rows && result.rows.length ? result.rows[0] : null);

        }
      );

      return this;

    }

  }

  return Composer;

})();
