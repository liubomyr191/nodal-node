module.exports = (function() {

  'use strict';

  /**
  * The current template, bound to specific params and data (passed on to partials)
  * @class
  */
  class ActiveTemplate {

    /**
    * @param {Nodal.Template} template The parent template
    * @param {Object} params The parameters for the template
    * @param {Object} data The data for the template
    */
    constructor(template, params, data) {

      this.template = template;
      this._params = params;
      this._data = data;

    }

    /**
    * Render the template based on this ActiveTemplate's params and data
    * @return {string}
    */
    generate() {

      return this.template._fn.call(this, this._params, this._data);

    }

    /**
    * Renders another template template based upon this ActiveTemplate's params and data
    * @return {string}
    */
    partial(name, raw) {

      return this.template._app.template(name, !!raw).generate(this._params, this._data);

    }

  }

  /**
  * Light wrapper around template functions, creates ActiveTemplates from provided params and data
  * @class
  */
  class Template {

    /**
    * @param {Nodal.Application} app Your Nodal Application
    * @param {function} fn The method to render your template with
    */
    constructor(app, fn) {

      this._app = app;
      this._fn = fn;

    }

    /**
    * Generates (renders) your template by creating an ActiveTemplate instance
    * @param {Object} params The parameters for the template
    * @param {Object} data The data for the template
    * @return {ActiveTemplate}
    */
    generate(params, data) {

      params = params || {};
      data = data || {};

      let templateData = this._app._templateData;

      Object.keys(templateData)
        .filter(k => !data.hasOwnProperty(k))
        .forEach(k => data[k] = templateData[k]);

      return new ActiveTemplate(this, params, data).generate();

    }

  }

  return Template;

})();
