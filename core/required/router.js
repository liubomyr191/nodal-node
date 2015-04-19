module.exports = function(Application) {

  var http = require('http');
  var url = require('url');
  var httpProxy = require('http-proxy');

  var Controller = require('./controller.js');
  var SocketServer = require('./socket.js');

  function Route(regex, controller) {
    this._regex = null;
    if(typeof regex === 'string') {
      this._regex = new RegExp(regex);
    } else if(regex instanceof RegExp) {
      this._regex = regex;
    } else {
      throw new Error('Routes must be strings or valid regular expression');
    }
    if(!Controller.prototype.isPrototypeOf(controller.prototype)) {
      throw new Error('Route requires a valid Controller');
    }
    this._controller = controller;
  };

  Route.prototype.match = function(pathname) {
    var matches = this._regex.exec(pathname);
    return !!matches && matches[0] === pathname;
  };

  Route.prototype.parseQueryParameters = function(query) {

    var obj = {};

    Object.keys(query).forEach(function(key) {

      var match, newKey, subKey;
      var value = query[key];

      if (match = key.match(/(.*)\[(.*)\]$/)) {

        newKey = match[1];
        subKey = match[2];

        if (subKey) {
          obj[newKey] || (obj[newKey] = {});
          obj[newKey][subKey] = value;
          return;
        }

        !(value instanceof Array) && (value = [value]);

        obj[newKey] = value;
        return;

      }

      obj[key] = value;
      return;

    });

    return obj;

  };

  Route.prototype.execute = function(request, response, urlParts, app, socket) {
    var controller = new this._controller(request, response);
    controller.get(controller, this.parseQueryParameters(urlParts.query), app, socket);
    return true;
  };

  function Router(port) {
    this._routes = [];
    this._socket = null;
    this._app = null;
    this._proxy = httpProxy.createProxyServer({ ws: true });
    this._server = http.createServer(this.execute.bind(this)).listen(port);
    console.log('Server listening on port ' + port);
  };

  Router.prototype.bindApplication = function(application) {

    if(!(application instanceof Application)) {
      throw new Error('bindApplication requires valid Application');
    }
    this._app = application;
    return true;

  };

  Router.prototype.bindSocket = function(socketServer) {
    if(!(socketServer instanceof SocketServer)) { throw new Error('bindSocket requires valid SocketServer'); }
    this._socket = socketServer;
    this._server.on('upgrade', (function (req, socket, head) {
      this._proxy.ws(req, socket, head, {target: 'ws://localhost:' + socketServer._port});
    }).bind(this));
    return true;
  };

  Router.prototype.route = function(regex, Controller) {
    this._routes.push(new Route(regex, Controller));
  };

  Router.prototype.find = function(pathname) {
    routes = this._routes;
    for(var i = 0, len = routes.length; i < len; i++) {
      if(routes[i].match(pathname)) {
        return routes[i];
      }
    }
    return null;
  };

  Router.prototype.execute = function(request, response) {
    var urlParts = url.parse(request.url, true);
    var route = this.find(urlParts.pathname);
    if (route) {
      return route.execute(request, response, urlParts, this._app, this._socket);
    }
    response.writeHead(404, {'Content-Type': 'text/plain'});
    response.end('404 Not Found');
    return;
  };

  return Router;

};
