module.exports = (function() {

  'use strict';

  const DataTypes = require('./data_types.js');
  const Database = require('./db/database.js');
  const Composer = require('./composer/composer.js');

  const utilities = require('./utilities.js');
  const async = require('async');

  class Model {

    static find(id, callback) {

      let db = this.prototype.db;

      // legacy support
      if (arguments.length === 3) {
        db = arguments[0];
        id = arguments[1];
        callback = arguments[2];
      }

      return new Composer(db, this)
        .filter({id: id})
        .end((err, models) => {

          if (!err && !models.length) {
            let err = new Error(`Could not find ${this.name} with id "${id}".`);
            err.notFound = true;
            return callback(err);
          }

          callback(err, models[0]);

        });

    }

    static create(data, callback) {

      let model = new this(data);
      model.save(callback);

    }

    static update(id, data, callback) {

      this.find(id, (err, model) => {

        if (err) {
          callback(err);
        }

        model.read(data);
        model.save(callback);

      });

    }

    static destroy(id, callback) {

      this.find(id, (err, model) => {

        if (err) {
          callback(err);
        }

        model.destroy(callback);

      });

    }

    static query(db) {

      db = db || this.prototype.db;
      return new Composer(db, this);

    }

    static columns() {
      return this.prototype.schema.columns.map(v => v.name);
    }

    static relationship(name) {
      return this.prototype.relationships[name];
    }

    static toResource(resourceColumns) {

      if (!resourceColumns || !resourceColumns.length) {
        resourceColumns = this.columns().concat(
          Object.keys(this.prototype.relationships)
            .map(r => {
              let obj = {};
              obj[r] = this.relationship(r).model.columns();
              return obj;
            })
        );
      }


      let columns = this.prototype.schema.columns;
      let columnLookup = {};
      columns.forEach(v => columnLookup[v.name] = v);

      resourceColumns = resourceColumns.map(r => {

        if (typeof r === 'string') {

          let field = columnLookup[r];
          let fieldData = {
            name: r,
            type: field ? field.type : 'string'
          };

          field.array && (fieldData.array = true);

          return fieldData;

        } else if (typeof r === 'object' && r !== null) {

          let key = Object.keys(r)[0];
          return this.relationship(key).model.toResource(r[key]);

        }

      }).filter(r => r);

      return {
        name: this.name,
        type: 'resource',
        fields: resourceColumns
      };

    }

    constructor(modelData, fromStorage) {

      modelData = modelData || {};

      this._validations = {};
      this._relationshipCache = {};

      this.__preInitialize__();
      this.__initialize__();
      this.__load__(modelData, fromStorage);
      this.__postInitialize__();

    }

    __preInitialize__() {
      return true;
    }

    __postInitialize__() {
      return true;
    }

    __initialize__() {

      this._inStorage = false;

      this._table = this.schema.table;
      this._fieldArray = this.schema.columns.slice();

      let fieldLookup = {};

      this._fieldArray.forEach(function(v) {
        fieldLookup[v.name] = v;
      });

      this._fieldLookup = fieldLookup;

      let data = {};
      let changed = {};

      this.fieldList().forEach(function(v) {
        data[v] = null;
        changed[v] = false;
      });

      this._data = data;
      this._changed = changed;
      this._errors = {};

      this.__validate__();

      return true;

    }

    inStorage() {
      return this._inStorage;
    }

    validates(field, message, fnAction) {

      this._validations[field] = this._validations[field] || [];
      this._validations[field].push({message: message, action: fnAction});

    }

    hasChanged(field) {
      return field === undefined ? this.changedFields().length > 0 : !!this._changed[field];
    }

    changedFields() {
      let changed = this._changed;
      return Object.keys(changed).filter(function(v) {
        return changed[v];
      });
    }

    errorObject() {

      let error = null;

      if (this.hasErrors()) {

        let errorObject = this.getErrors();
        let message = errorObject._query || 'There was an error with your request';

        error = new Error(message);
        error.details = errorObject;

      }

      return error;

    }

    hasErrors() {

      return Object.keys(this._errors).length > 0;

    }

    getErrors() {
      let obj = {};
      let errors = this._errors;
      Object.keys(errors).forEach(function(key) {
        obj[key] = errors[key];
      });
      return obj;
    }

    __validate__(fieldList) {

      let data = this._data;

      this.clearError('*');

      return (fieldList || this.fieldList()).filter((function(field) {

        this.clearError(field);
        let value = data[field];

        return (this._validations[field] || []).filter((function(validation) {

          let isValid = validation.action.call(null, value);
          return !(isValid || !this.setError(field, validation.message));

        }).bind(this)).length > 0;

      }).bind(this)).concat((this._validations['*'] || []).filter((function(validation) {

        let isValid = validation.action.call(null, data);
        return !(isValid || !this.setError('*', validation.message));

      }).bind(this))).length > 0;

    }

    __load__(data, fromStorage) {

      this._inStorage = !!fromStorage;
      fromStorage && (this._errors = {}); // clear errors if in storage

      if (!fromStorage) {
        this.set('created_at', new Date());
      }

      this.fieldList()
        .concat(Object.keys(this.relationships))
        .filter((key) => data.hasOwnProperty(key))
        .forEach((key) => {
        // do not validate or log changes when loading from storage
          this.set(key, data[key], !fromStorage, !fromStorage);
        });

      return this;

    }

    read(data) {

      this.fieldList()
        .concat(Object.keys(this.relationships))
        .filter((key) => data.hasOwnProperty(key))
        .forEach((key) => this.set(key, data[key]));

      return this;

    }

    set(field, value, validate, logChange) {

      if (this.relationships[field]) {
        let rel = this.relationships[field];
        if (!(value instanceof rel.model)) {
          throw new Error(`${value} is not an instance of ${rel.model.name}`);
        }
        this._relationshipCache[field] = value;
        return this.set(rel.via, value.get('id'));
      }

      validate = (validate === undefined) ? true : !!validate;
      logChange = (logChange === undefined) ? true : !!logChange;

      if (!this.hasField(field)) {

        throw new Error('Field ' + field + ' does not belong to model ' + this.constructor.name);

      }

      let dataType = this.getDataTypeOf(field);
      let newValue = null;

      value = (value !== undefined) ? value : null;

      if (value !== null) {
        if (this.isFieldArray(field)) {
          newValue = value instanceof Array ? value : [value];
          newValue = newValue.map(function(v) { return dataType.convert(v); });
        } else {
          newValue = dataType.convert(value);
        }
      }

      let curValue = this._data[field];
      let changed = false;

      if (newValue !== curValue) {
        if (newValue instanceof Array && curValue instanceof Array) {
          if (newValue.filter(function(v, i) { return v !== curValue[i]; }).length) {
            this._data[field] = newValue;
            logChange && (changed = true);
          }
        } else {
          this._data[field] = newValue;
          logChange && (changed = true);
        }
      }

      this._changed[field] = changed;
      validate && (!logChange || changed) && this.__validate__([field]);

      return value;

    }

    get(key, ignoreFormat) {
      let datum = this._data[key];
      return (!ignoreFormat && this.formatters[key]) ? this.formatters[key](datum) : datum;
    }

    relationship(callback) {

      let db = this.db;

      // legacy support
      if (arguments.length === 2) {
        db = arguments[0];
        callback = arguments[1];
      }

      let relationships = utilities.getFunctionParameters(callback);
      relationships = relationships.slice(1);

      if (!relationships.length) {
        throw new Error('No valid relationships (1st parameter is error)');
      }

      let invalidRelationships = relationships.filter(r => !this.relationships[r]);

      if (invalidRelationships.length) {
        throw new Error(`Relationships "${invalidRelationships.join('", "')}" for model "${this.constructor.name}" do not exist.`);
      }

      let fns = relationships.map(r => this.relationships[r]).map(r => {
        return (callback) => {
          r.model.find(db, this.get(r.via), (err, model) => {
            callback(err, model);
          });
        }
      });

      async.parallel(fns, (err, results) => {

        relationships.forEach((r, i) => {
          this.set(r, results[i]);
        });

        return callback.apply(this, [err].concat(results));

      });

    };

    toObject(arrInterface) {

      let obj = {};

      if (arrInterface) {

        arrInterface.forEach(key => {

          if (typeof key === 'object' && key !== null) {
            let relationship = Object.keys(key)[0];
            if (this._relationshipCache[relationship]) {
              obj[key] = this._relationshipCache[relationship].toObject(key[relationship]);
            }
          } else if (this._data[key]) {
            obj[key] = this.get(key);
          }

        });

      } else {

        Object.keys(this._data).forEach(key => obj[key] = this.get(key));
        Object.keys(this.relationships).forEach(key => {
          obj[key] = this._relationshipCache[key] ? this._relationshipCache[key].toObject() : null;
        });

      }

      return obj;

    }

    tableName() {
      return this._table;
    }

    hasField(field) {
      return !!this._fieldLookup[field];
    }

    getFieldData(field) {
      return this._fieldLookup[field];
    }

    getDataTypeOf(field) {
      return DataTypes[this._fieldLookup[field].type];
    }

    isFieldArray(field) {
      let fieldData = this._fieldLookup[field];
      return !!(fieldData && fieldData.properties && fieldData.properties.array);
    }

    isFieldPrimaryKey(field) {
      let fieldData = this._fieldLookup[field];
      return !!(fieldData && fieldData.properties && fieldData.properties.primary_key);
    }

    fieldDefaultValue(field) {
      let fieldData = this._fieldLookup[field];
      return !!(fieldData && fieldData.properties && fieldData.properties.array);
    }

    fieldList() {
      return this._fieldArray.map(function(v) { return v.name; });
    }

    fieldDefinitions() {
      return this._fieldArray.slice();
    }

    setError(key, message) {
      this._errors[key] = this._errors[key] || [];
      this._errors[key].push(message);
      return true;
    }

    clearError(key) {
      delete this._errors[key];
      return true;
    }

    save(callback) {

      let db = this.db;

      // Legacy
      if (arguments.length === 2) {
        db = arguments[0];
        callback = arguments[1];
      }

      if (this.readOnly) {
        throw new Error(this.constructor.name + ' is marked as readOnly, can not save');
      }

      let model = this;

      if (!(db instanceof Database)) {
        throw new Error('Must provide a valid Database to save to');
      }

      if(typeof callback !== 'function') {
        callback = function() {};
      }

      if (model.hasErrors()) {
        callback.call(model, {message: 'Validation error', fields: model.getErrors()}, model);
        return;
      }

      let columns, query;

      if (!model.inStorage()) {

        columns = model.fieldList().filter(function(v) {
          return !model.isFieldPrimaryKey(v) && model.get(v, true) !== null;
        });

        query = db.adapter.generateInsertQuery(model.schema.table, columns);

      } else {

        columns = ['id'].concat(model.changedFields().filter(function(v) {
          return !model.isFieldPrimaryKey(v);
        }));

        query = db.adapter.generateUpdateQuery(model.schema.table, columns);

      }

      db.query(
        query,
        columns.map(function(v) {
          return db.adapter.sanitize(model.getFieldData(v).type, model.get(v, true));
        }),
        function(err, result) {

          if (err) {
            model.setError('_query', err.message);
          } else {
            result.rows.length && model.__load__(result.rows[0], true);
          }

          callback.call(model, model.errorObject(), model);

        }
      );

    }

    destroy(callback) {

      let db = this.db;

      // Legacy
      if (arguments.length === 2) {
        db = arguments[0];
        callback = arguments[1];
      }

      if (this.readOnly) {
        throw new Error(this.constructor.name + ' is marked as readOnly, can not destroy');
      }

      let model = this;

      if (!(db instanceof Database)) {
        throw new Error('Must provide a valid Database to save to');
      }

      if(typeof callback !== 'function') {
        callback() = function() {};
      }

      if (!model.inStorage()) {

        setTimeout(callback.bind(model, {'_query': 'Model has not been saved'}, model), 1);
        return;

      }

      let columns = model.fieldList().filter(function(v) {
        return model.isFieldPrimaryKey(v);
      });

      let query = db.adapter.generateDeleteQuery(model.schema.table, columns);

      db.query(
        query,
        columns.map(function(v) {
          return db.adapter.sanitize(model.getFieldData(v).type, model.get(v, true));
        }),
        function(err, result) {

          if (err) {
            model.setError('_query', err.message);
          } else {
            model._inStorage = false;
          }

          callback.call(model, model.errorObject(), model);

        }
      );

    }

  }

  Model.prototype.schema = {
    table: '',
    columns: []
  };

  Model.prototype.relationships = {};
  Model.prototype.formatters = {};

  Model.prototype.readOnly = false;

  Model.prototype.data = null;

  Model.prototype.db = null;

  Model.prototype.externalInterface = [
    'id',
    'created_at'
  ];

  Model.prototype.aggregateBy = {
    'id': 'count',
    'created_at': 'min'
  };

  return Model;

})();
