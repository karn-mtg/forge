'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  defaultFormat: 'commander',
};

function getSettingsPath(userDataPath) {
  return path.join(userDataPath, 'settings.json');
}

function getSettings(userDataPath) {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(getSettingsPath(userDataPath), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function setSettings(userDataPath, updates) {
  const next = { ...getSettings(userDataPath), ...updates };
  fs.writeFileSync(getSettingsPath(userDataPath), JSON.stringify(next, null, 2));
  return next;
}

module.exports = { getSettings, setSettings };
