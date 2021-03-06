let utils = require('../../utils/utils');
const EmbarkJS = require('embarkjs');
const IpfsApi = require('ipfs-api');
const Web3 = require('web3');

class Console {
  constructor(_embark, options) {
    this.events = options.events;
    this.plugins = options.plugins;
    this.version = options.version;
    this.logger = options.logger;
    this.ipc = options.ipc;
    this.config = options.config;

    if (this.ipc.isServer()) {
      this.ipc.on('console:executeCmd', this.executeCmd.bind(this));
    }
    this.events.setCommandHandler("console:executeCmd", this.executeCmd.bind(this));
    this.registerEmbarkJs();
  }

  processEmbarkCmd (cmd) {
    if (cmd === 'help' || cmd === __('help')) {
      let helpText = [
        __('Welcome to Embark') + ' ' + this.version,
        '',
        __('possible commands are:'),
        'versions - ' + __('display versions in use for libraries and tools like web3 and solc'),
        // TODO: only if the blockchain is actually active!
        // will need to pass te current embark state here
        'ipfs - ' + __('instantiated js-ipfs object configured to the current environment (available if ipfs is enabled)'),
        'web3 - ' + __('instantiated web3.js object configured to the current environment'),
        'EmbarkJS - ' + __('EmbarkJS static functions for Storage, Messages, Names, etc.'),
        'quit - ' + __('to immediatly exit (alias: exit)'),
        '',
        __('The web3 object and the interfaces for the deployed contracts and their methods are also available')
      ];
      return helpText.join('\n');
    } else if (['quit', 'exit', 'sair', 'sortir', __('quit')].indexOf(cmd) >= 0) {
      utils.exit();
    }
    return false;
  }

  executeCmd(cmd, callback) {
    var pluginCmds = this.plugins.getPluginsProperty('console', 'console');
    for (let pluginCmd of pluginCmds) {
      let pluginResult = pluginCmd.call(this, cmd, {});
      if(typeof pluginResult !== 'object'){
        if (pluginResult !== false && pluginResult !== 'false' && pluginResult !== undefined) {
          this.logger.warn("[DEPRECATED] In future versions of embark, we expect the console command to return an object " +
            "having 2 functions: match and process. The documentation with example can be found here: https://embark.status.im/docs/plugin_reference.html#embark-registerConsoleCommand-callback-options");
          return callback(null, pluginResult);
        }
      } else if (pluginResult.match()) {
        return pluginResult.process(callback);
      }
    }

    let output = this.processEmbarkCmd(cmd);
    if (output) {
      return callback(null, output);
    }

    try {
      this.events.request('runcode:eval', cmd, callback);
    }
    catch (e) {
      if (this.ipc.connected && this.ipc.isClient()) {
        return this.ipc.request('console:executeCmd', cmd, callback);
      }
      callback(e);
    }
  }

  registerEmbarkJs() {
    this.events.emit('runcode:register', 'IpfsApi', IpfsApi, false);
    this.events.emit('runcode:register', 'Web3', Web3, false);
    this.events.emit('runcode:register', 'EmbarkJS', EmbarkJS, false);

    this.events.once('code-generator-ready', () => {
      if (this.ipc.connected) {
        return;
      }

      this.events.request('code-generator:embarkjs:provider-code', (code) => {
        const func = () => {};
        this.events.request('runcode:eval', code, func, true);
        this.events.request('runcode:eval', this.getInitProviderCode(), func, true);
      });
    });
  }

  getInitProviderCode() {
    const codeTypes = {
      'communication': this.config.communicationConfig || {},
      'names': this.config.namesystemConfig || {},
      'storage': this.config.storageConfig || {}
    };

    return this.plugins.getPluginsFor('initConsoleCode').reduce((acc, plugin) => {
      Object.keys(codeTypes).forEach(codeTypeName => {
        (plugin.embarkjs_init_console_code[codeTypeName] || []).forEach(initCode => {
          let [block, shouldInit] = initCode;
          if (shouldInit.call(plugin, codeTypes[codeTypeName])) {
            acc += block;
          }
        });
      });
      return acc;
    }, '');
  }
}

module.exports = Console;
