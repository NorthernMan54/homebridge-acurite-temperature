'use strict';

var debug = require('debug')('acurite');
var logger = require("mcuiot-logger").logger;
//var spawn = require('child_process').spawn;
const moment = require('moment');
var os = require("os");
var hostname = os.hostname();

let Service, Characteristic;
var CustomCharacteristic;
var FakeGatoHistoryService;
var refresh;

var myAccessories = [];

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  CustomCharacteristic = require('./lib/CustomCharacteristic.js')(homebridge);
  FakeGatoHistoryService = require('fakegato-history')(homebridge);

  homebridge.registerPlatform('homebridge-acurite-temperature', 'Acurite', AcuritePlugin);
};

function AcuritePlugin(log, config, api) {

  this.log = log;
  this.name1 = config.name1;
  this.name2 = config.name2;
  refresh = config['refresh'] || 60; // Update every minute
  this.options = config.options || {};
  this.storage = config['storage'] || "fs";
  this.spreadsheetId = config['spreadsheetId'];
  this.devices = config['devices'];
  if (this.spreadsheetId) {
    this.log_event_counter = 59;
    this.logger = new logger(this.spreadsheetId);
  }
  this.lastUpdated = Date.now();

}

AcuritePlugin.prototype = {
  accessories: function(callback) {
    for (var i in this.devices) {
      this.log("Adding device", i, this.devices[i]);
      myAccessories.push(new acuriteAccessory(this.devices[i], this.log, i));
    }
    callback(myAccessories);

    var child_process = require('child_process');
    var readline = require('readline');
    var proc = child_process.spawn('/usr/local/bin/rtl_433', ['-q', '-F', 'json', '-C', 'si']);
    readline.createInterface({
      input: proc.stdout,
      terminal: false
    }).on('line', function(message) {
      debug("Message", message.toString());
      if (message.toString().startsWith('{')) {
        var data = JSON.parse(message.toString());
        getDevice(data.channel).updateStatus(data.temperature_C, data.battery);
        // {"time" : "2018-06-02 08:27:20", "model" : "Acurite 986 Sensor", "id" : 3929, "channel" : "2F", "temperature_F" : -11, "temperature_C" : -23.889, "battery" : "OK", "status" : 0}
      }
    }.bind(this));
  }
}

function acuriteAccessory(name, log, unit) {
  this.unit = unit;
  this.log = log;
  this.name = name;
}

acuriteAccessory.prototype = {
  updateStatus: function(temperature, battery) {
    try {
      this.log("Updating", this.name, temperature, battery);
      this.lastUpdated = Date.now();
      clearTimeout(this.timeout);
      this.timeout = setTimeout(deviceTimeout.bind(this), 5 * 60 * 1000); // 5 minutes
      this.loggingService.addEntry({
        time: moment().unix(),
        temp: roundInt(temperature)
      });

      if (this.spreadsheetId) {
        this.log_event_counter = this.log_event_counter + 1;
        if (this.log_event_counter > 59) {
          this.logger.storeBME(this.name, 0, roundInt(temperature));
          this.log_event_counter = 0;
        }
      }
      this.temperatureService
        .setCharacteristic(Characteristic.CurrentTemperature, roundInt(temperature));
      if (battery == "OK") {
        this.temperatureService
          .setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
      } else {
        this.temperatureService
          .setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
      }
    } catch (err) {
      this.log.error("Error", err);
    }
  },

  getServices: function() {
    this.log("getServices", this.name);
    // Information Service
    var informationService = new Service.AccessoryInformation();

    informationService
      .setCharacteristic(Characteristic.Manufacturer, "homebridge-acurite")
      .setCharacteristic(Characteristic.SerialNumber, hostname + "-" + this.name)
      .setCharacteristic(Characteristic.FirmwareRevision, require('./package.json').version);
    // Thermostat Service
    this.temperatureService = new Service.TemperatureSensor(this.name);

    this.temperatureService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minValue: -100,
        maxValue: 100
      });

    this.timeout = setTimeout(deviceTimeout.bind(this), 5 * 60 * 1000); // 5 minutes

    this.temperatureService.log = this.log;
    this.loggingService = new FakeGatoHistoryService("weather", this.temperatureService, {
      storage: this.storage,
      minutes: refresh * 10 / 60
    });

    return [informationService, this.temperatureService, this.loggingService];
  }
}

function deviceTimeout() {
  this.log("Timeout", this.name);
  this.temperatureService
    .getCharacteristic(Characteristic.CurrentTemperature).updateValue(new Error("No response"));
}

function deviceModel(data) {
  if (data[2] == "Acurite")
    return "Acurite";
}

function roundInt(string) {
  return Math.round(parseFloat(string) * 10) / 10;
}

function getDevice(unit) {
  for (var i in myAccessories) {
    if (myAccessories[i].unit == unit)
      return myAccessories[i];
  }
  this.log.error("ERROR: unknown unit -", unit);
}
