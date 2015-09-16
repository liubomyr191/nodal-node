"use strict";

module.exports = (function() {

  const DatabaseAdapter = require('../adapter.js');

  class PostgresAdapter extends DatabaseAdapter {

    generateArray(arr) {

      return '{' + arr.join(',') + '}';

    }

    generateConnectionString(host, port, database, user, password) {

      return 'postgres://' + user + ':' + password + '@' + host + ':' + port + '/' + database;

    }

    generateClearDatabaseQuery() {

      return [
        'DROP SCHEMA public CASCADE',
        'CREATE SCHEMA public'
      ].join(';')

    }

    generateCreateDatabaseQuery(name) {

      return [
        'CREATE DATABASE',
        this.escapeField(name)
      ].join(' ');

    }

    generateDropDatabaseQuery(name) {

      return [
        'DROP DATABASE IF EXISTS',
        this.escapeField(name)
      ].join(' ');

    }

    generateColumn(columnName, columnType, columnProperties) {

      return [
        this.escapeField(columnName),
        columnType,
        columnProperties.array ? 'ARRAY' : '',
        (columnProperties.primary_key || !columnProperties.nullable) ? 'NOT NULL' : ''
      ].filter(function(v) { return !!v; }).join(' ');

    }

    generateAlterColumn(columnName, columnType, columnProperties) {

      return [
        'ALTER COLUMN',
        this.escapeField(columnName),
        'TYPE',
        columnType,
        columnProperties.array ? 'ARRAY' : '',
      ].filter(function(v) { return !!v; }).join(' ');

    }

    generateAlterColumnSetNull(columnName, columnType, columnProperties) {

      return [
        'ALTER COLUMN',
        this.escapeField(columnName),
        (columnProperties.primary_key || !columnProperties.nullable) ? 'SET' : 'DROP',
        'NOT NULL'
      ].join(' ');

    }

    generateAlterColumnDropDefault(columnName, columnType, columnProperties) {

      return [
        'ALTER COLUMN',
        this.escapeField(columnName),
        'DROP DEFAULT'
      ].join(' ');

    }

    generateAlterColumnSetDefaultSeq(columnName, seqName) {
      return [
        'ALTER COLUMN ',
          this.escapeField(columnName),
        ' SET DEFAULT nextval(\'',
          seqName,
        '\')'
      ].join('');
    }

    generateIndex(table, columnName) {

      return this.generateConstraint(table, columnName, 'index');

    }

    generateConstraint(table, columnName, suffix) {
      return this.escapeField([table, columnName, suffix].join('_'));
    }

    generatePrimaryKey(table, columnName) {

      return ['CONSTRAINT ', this.generateConstraint(table, columnName, 'pk'), ' PRIMARY KEY(', this.escapeField(columnName), ')'].join('');

    }

    generateUniqueKey(table, columnName) {

      return ['CONSTRAINT ', this.generateConstraint(table, columnName, 'unique'), ' UNIQUE(', this.escapeField(columnName), ')'].join('');

    }

    generateAlterTableRename(table, newTableName, columns) {

      let self = this;

      return [
        [
          'ALTER TABLE',
            this.escapeField(table),
          'RENAME TO',
            this.escapeField(newTableName)
        ].join(' '),
      ].concat(
        this.getPrimaryKeys(columns).map(function(columnData) {
          return [
            'ALTER TABLE',
              self.escapeField(newTableName),
            'RENAME CONSTRAINT',
              self.generateConstraint(table, columnData.name, 'pk'),
            'TO',
              self.generateConstraint(newTableName, columnData.name, 'pk')
          ].join(' ');
        }),
        this.getUniqueKeys(columns).map(function(columnData) {
          return [
            'ALTER TABLE',
              self.escapeField(newTableName),
            'RENAME CONSTRAINT',
              self.generateConstraint(table, columnData.name, 'unique'),
            'TO',
              self.generateConstraint(newTableName, columnData.name, 'unique')
          ].join(' ');
        }),
        this.getAutoIncrementKeys(columns).map(function(columnData) {
          return self.generateRenameSequenceQuery(table, columnData.name, newTableName, columnData.name);
        })
      ).join(';');
    }

    generateAlterTableColumnType(table, columnName, columnType, columnProperties) {

      let queries = [
        [
          'ALTER TABLE',
            this.escapeField(table),
            this.generateAlterColumn(columnName, columnType, columnProperties)
        ].join(' '),
        [
          'ALTER TABLE',
            this.escapeField(table),
            this.generateAlterColumnSetNull(columnName, columnType, columnProperties)
        ].join(' '),
        [
          'ALTER TABLE',
            this.escapeField(table),
            this.generateAlterColumnDropDefault(columnName)
        ].join(' '),
        this.generateDropSequenceQuery(table, columnName)
      ]

      if (columnProperties.auto_increment) {
        queries.push(this.generateCreateSequenceQuery(table, columnName));
        queries.push([
          'ALTER TABLE',
            this.escapeField(table),
            this.generateAlterColumnSetDefaultSeq(columnName, this.generateSequence(table, columnName))
        ].join(' '));
      }

      return queries.join(';');

    }

    generateAlterTableAddPrimaryKey(table, columnName) {

      return [
        'ALTER TABLE',
          this.escapeField(table),
        'ADD',
          this.generatePrimaryKey(table, columnName)
      ].join(' ');

    }

    generateAlterTableDropPrimaryKey(table, columnName) {

      return [
        'ALTER TABLE',
          this.escapeField(table),
        'DROP CONSTRAINT IF EXISTS',
          this.generateConstraint(table, columnName, 'pk')
      ].join(' ');

    }

    generateAlterTableAddUniqueKey(table, columnName) {

      return [
        'ALTER TABLE',
          this.escapeField(table),
        'ADD',
          this.generateUniqueKey(table, columnName)
      ].join(' ');

    }

    generateAlterTableDropUniqueKey(table, columnName) {

      return [
        'ALTER TABLE',
          this.escapeField(table),
        'DROP CONSTRAINT IF EXISTS',
          this.generateConstraint(table, columnName, 'unique')
      ].join(' ');

    }

    generateAlterTableAddColumn(table, columnName, columnType, columnProperties) {

      return [
        'ALTER TABLE',
          this.escapeField(table),
        'ADD COLUMN',
          this.generateColumn(columnName, columnType, columnProperties)
      ].join(' ');

    }

    generateAlterTableDropColumn(table, columnName) {

      return [
        'ALTER TABLE',
          this.escapeField(table),
        'DROP COLUMN IF EXISTS',
          this.escapeField(columnName)
      ].join(' ');

    }

    generateAlterTableRenameColumn(table, columnName, newColumnName) {

      return [
        'ALTER TABLE',
          this.escapeField(table),
        'RENAME COLUMN',
          this.escapeField(columnName),
        'TO',
        this.escapeField(newColumnName)
      ].join(' ');

    }

    generateCreateIndex(table, columnName, indexType) {

      indexType = this.indexTypes.indexOf(indexType) > -1 ? indexType : this.indexTypes[0];

      return [
        'CREATE INDEX',
          this.generateIndex(table, columnName),
        'ON',
          this.escapeField(table),
        'USING',
          indexType,
        ['(', this.escapeField(columnName), ')'].join('')
      ].join(' ');

    }

    generateDropIndex(table, columnName) {

      return [
        'DROP INDEX', this.generateIndex(table, columnName)
      ].join(' ');

    }

    generateSequence(table, columnName) {
      return this.generateConstraint(table, columnName, 'seq');
    }

    generateCreateSequenceQuery(table, columnName) {

      return [
        [
          'CREATE SEQUENCE',
            this.generateSequence(table, columnName),
          'START 1',
          'OWNED BY',
            [this.escapeField(table), this.escapeField(columnName)].join('.')
        ].join(' '),
        [
          'SELECT setval(\'',
            this.generateSequence(table, columnName),
          '\', GREATEST(COALESCE(MAX(',
            this.escapeField(columnName),
          '), 0), 0) + 1, false) FROM ',
            this.escapeField(table)
        ].join('')
      ].join(';');

    }

    generateRenameSequenceQuery(table, columnName, newTable, newColumnName) {

      return [
        'ALTER SEQUENCE',
          this.generateSequence(table, columnName),
        'RENAME TO',
          this.generateSequence(newTable, newColumnName)
      ].join(' ');

    }

    generateDropSequenceQuery(table, columnName) {
      return [
        'DROP SEQUENCE IF EXISTS',
        this.generateSequence(table, columnName)
      ].join(' ');
    }

    generateCreateTableQuery(table, columns) {

      // Create sequences along with table
      let self = this;

      return [
        super.generateCreateTableQuery(table, columns),
        this.getAutoIncrementKeys(columns).map(function(columnData) {
          return [
            self.generateCreateSequenceQuery(table, columnData.name),
            [
              'ALTER TABLE',
                self.escapeField(table),
                self.generateAlterColumnSetDefaultSeq(columnData.name, self.generateSequence(table, columnData.name))
            ].join(' ')
          ].join(';');
        })
      ].join(';');

    }

    generateLimitClause(limitObj) {

      return (!limitObj) ? '' :
        (limitObj.count ? ` LIMIT ${limitObj.count}` : '') +
        (limitObj.offset ? ` OFFSET ${limitObj.offset}` : '');

    }

  }

  PostgresAdapter.prototype.sanitizeType = {
    boolean: function(v) {
      return ['f', 't'][v | 0];
    }
  }

  PostgresAdapter.prototype.escapeFieldCharacter = '"';

  PostgresAdapter.prototype.indexTypes = [
    'btree',
    'hash',
    'gist',
    'gin'
  ];

  PostgresAdapter.prototype.types = {
    serial: {
      dbName: 'BIGINT',
      properties: {
        primary_key: true,
        nullable: false,
        auto_increment: true
      }
    },
    int: {
      dbName: 'BIGINT'
    },
    currency: {
      dbName: 'BIGINT'
    },
    float: {
      dbName: 'FLOAT'
    },
    string: {
      dbName: 'VARCHAR'
    },
    text: {
      dbName: 'TEXT'
    },
    datetime: {
      dbName: 'TIMESTAMP'
    },
    boolean: {
      dbName: 'BOOLEAN'
    }
  };

  return PostgresAdapter;

})();
