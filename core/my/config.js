module.exports = (() => {

  'use strict';

  const env = require('./../env.js');

  const fs = require('fs');
  const dot = require('dot');

  let config = {};

  let varname = dot.templateSettings.varname;

  dot.templateSettings.varname = 'env';

  let dir = env.rootDirectory + '/config';
  let configFiles = fs.readdirSync(dir);

  let ext = '.json';

  configFiles.filter(function(filename) {
    let name = filename.substr(0, filename.length - ext.length);
    return !config[name] && filename.substr(filename.length - ext.length) === ext;
  }).forEach(function(filename) {

    let configData;

    try {
      configData = fs.readFileSync([dir, filename].join('/'));
      configData = dot.template(configData)(process.env);
      configData = JSON.parse(configData);
    } catch(e) {
      configData = {};
    }

    config[filename.substr(0, filename.length - ext.length)] = configData[env.name];

  });

  console.log('ENVIRONMENT', env.name);
  console.log(config);

  dot.templateSettings.varname = varname;

  return config;

})();
