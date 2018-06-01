'use strict';

var debug = require('debug')('acurite');
var logger = require("mcuiot-logger").logger;
var spawn = require('child_process').spawn;
const moment = require('moment');
var os = require("os");
var hostname = os.hostname();

let Service, Characteristic;
var CustomCharacteristic;
var FakeGatoHistoryService;

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
  this.refresh = config['refresh'] || 60; // Update every minute
  this.options = config.options || {};
  this.storage = config['storage'] || "fs";
  this.spreadsheetId = config['spreadsheetId'];
  if (this.spreadsheetId) {
    this.log_event_counter = 59;
    this.logger = new logger(this.spreadsheetId);
  }
  this.lastUpdated = Date.now();

}

AcuritePlugin.prototype = {
  accessories: function(callback) {
    this.log("accessories");
    myAccessories.push(new acuriteAccessory(this.name1,this.log));
    myAccessories.push(new acuriteAccessory(this.name2,this.log));
    callback(myAccessories);

    var proc = spawn('/usr/local/bin/rtl_433', ['-q', '-G']);
    var start;

    proc.stdout.on('data', function(message) {
        // {"time" : "2018-05-29 22:12:30", "model" : "Philips outdoor temperature sensor", "channel" : 1, "temperature_C" : 8.300, "battery" : "OK"}
        this.log(message.toString());

        var data = message.toString().split(" ");

        //this.log("Data",data);

        // [ '2018-05-31',  '23:15:21',  'Acurite',  '986',  'sensor',  '0xc8e0',  '-',  '2F:',  '-17.2',  'C',  '1',

        this.log(data[2],data[7],data[8]);
        if ( data[2] == "Acurite") {
          if ( data[7] == "1R:" ) {
            myAccessories[0].updateStatus(data[8]);
          } else {
            myAccessories[1].updateStatus(data[8]);
          }
        }

      }.bind(this)

    );
    proc.stderr.on('data', function(message) {
      this.log.error("stderr", message.toString());
    }.bind(this));
    proc.on('close', function(code, signal) {
      this.log.error('rtl_433 closed');
    }.bind(this));
  }
}


class AcuritePluginOld {
  constructor(log, config, api) {
    this.log = log;
    this.name = config.name;
    this.name_temperature = config.name_temperature || this.name;
    this.name_humidity = config.name_humidity || this.name;
    this.refresh = config['refresh'] || 60; // Update every minute
    this.options = config.options || {};
    this.storage = config['storage'] || "fs";
    this.spreadsheetId = config['spreadsheetId'];
    if (this.spreadsheetId) {
      this.log_event_counter = 59;
      this.logger = new logger(this.spreadsheetId);
    }
    this.lastUpdated = Date.now();

    this.informationService = new Service.AccessoryInformation();

    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, "acurite-Temperature")
      .setCharacteristic(Characteristic.SerialNumber, hostname + "-" + this.name_temperature)
      .setCharacteristic(Characteristic.FirmwareRevision, require('./package.json').version);

    this.temperatureService = new Service.TemperatureSensor(this.name_temperature);

    this.temperatureService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minValue: -100,
        maxValue: 100
      });

    setInterval(this.heartbeat.bind(this), this.refresh * 1000);

    this.temperatureService.log = this.log;
    this.loggingService = new FakeGatoHistoryService("weather", this.temperatureService, {
      storage: this.storage,
      minutes: this.refresh * 10 / 60
    });

  }

  heartbeat() {
    if (Date.now() - this.lastUpdated > 15 * 60 * 1000) // Alert after 15 minutes of no Data
    {
      this.log.error("No response from sensor");
      this.temperatureService
        .getCharacteristic(Characteristic.CurrentTemperature).updateValue(new Error("No response"));
    }
  }

  getServices() {
    return [this.informationService, this.temperatureService, this.loggingService]
  }
}

function acuriteAccessory(name,log) {
  console.log("THIS",this);
  this.log = log;
  this.name = name;
}

acuriteAccessory.prototype = {

  updateStatus: function(data) {
    try {
      this.log("Message", data);


      this.lastUpdated = Date.now();
      this.loggingService.addEntry({
        time: moment().unix(),
        temp: roundInt(data)
      });

      if (this.spreadsheetId) {
        this.log_event_counter = this.log_event_counter + 1;
        if (this.log_event_counter > 59) {
          this.logger.storeBME(this.name, 0, roundInt(data));
          this.log_event_counter = 0;
        }
      }
      this.temperatureService
        .setCharacteristic(Characteristic.CurrentTemperature, roundInt(data));
      if (data.battery != "OK") {
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

    //setInterval(this.heartbeat.bind(this), this.refresh * 1000);

    this.temperatureService.log = this.log;
    this.loggingService = new FakeGatoHistoryService("weather", this.temperatureService, {
      storage: this.storage,
      minutes: this.refresh * 10 / 60
    });

    return [informationService, this.temperatureService, this.loggingService];

  }
}


function roundInt(string) {
  return Math.round(parseFloat(string) * 10) / 10;
}
