"use strict";

module.exports = (function() {

  let fs = require('fs');
  let Database = require('../../core/module.js').Database;

  let colors = require('colors/safe');
  let inflect = require('i')();

  let generateMigration = require('./migration.js').generate;

  let dot = require('dot');

  dot.templateSettings.strip = false;
  dot.templateSettings.varname = 'data';

  let modelDir = './app/models';

  function generateModelDefinition(modelName, columns) {

    let model = {
      name: modelName,
      columns: columns
    };

    return dot.template(
      fs.readFileSync(__dirname + '/templates/model.jst', {
        varname: 'data',
        strip: false
      }).toString()
    )(model);

  }

  function generateUserDefinition(columns) {
    return dot.template(
      fs.readFileSync(__dirname + '/templates/models/user.jst', {
        varname: 'data',
        strip: false
      }).toString()
    )({columns: columns});
  };

  function convertArgListToPropertyList(argList) {
    return argList.slice(1).map(function(v) {
      let obj = {name: inflect.underscore(v[0]), type: v[1]};
      if (v[2] && (v[2] === 'array')) {
        obj.properties = {array: true};
      }
      return obj;
    });
  }

  function generateModelSchemaObject(modelName, propertyList) {

    return {
      table: inflect.tableize(modelName),
      columns: propertyList
    };

  }

  return {
    command: function(args, flags) {

      if (flags.hasOwnProperty('user')) {
        args = [
          ['User'],
          ['email', 'string'],
          ['password', 'string'],
          ['name', 'string'],
          ['permission', 'int'],
          ['ip_address', 'string']
        ];
      }

      if (!args.length) {
        console.error(colors.red.bold('Error: ') + 'No model name specified.');
        return;
      }

      let modelName = inflect.classify(args[0][0]);

      let schemaObject = generateModelSchemaObject(modelName, convertArgListToPropertyList(args));

      !fs.existsSync(modelDir) && fs.mkdirSync(modelDir);

      let createPath = modelDir + '/' + inflect.underscore(modelName) + '.js';

      if (fs.existsSync(createPath)) {
        throw new Error('Model already exists');
      }

      if (flags.hasOwnProperty('user')) {
        fs.writeFileSync(createPath, generateUserDefinition(
          ['id'].concat(
            schemaObject.columns.map(function(v) { return v.name; }).filter(function(v) {
              return ['ip_address', 'permission', 'password'].indexOf(v) === -1;
            }),
            ['created_at']
          )
        ));
      } else {
        fs.writeFileSync(createPath, generateModelDefinition(
          modelName,
          ['id'].concat(
            schemaObject.columns.map(function(v) { return v.name; }),
            ['created_at']
          )
        ));
      }

      console.log(colors.green.bold('Create: ') + createPath);

      generateMigration('Create' + modelName,
        ['this.createTable(\"' + schemaObject.table + '\", ' + JSON.stringify(schemaObject.columns) + ')'],
        ['this.dropTable(\"' + schemaObject.table + '\")']
      );

      process.exit(0);

    }
  };

})();
