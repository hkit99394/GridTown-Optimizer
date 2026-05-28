const assert = require("node:assert/strict");

const {
  DEFAULT_MAX_RUNNING_SOLVES,
  DEFAULT_PLANNER_PORT,
  DEFAULT_PROGRESS_LOG_INTERVAL_SECONDS,
  parseLocalServerPort,
  parsePositiveIntegerConfig,
  parsePositiveMillisecondsFromSecondsConfig
} = require("../dist/apps/planner-server/serverConfig.js");

function testPortParsingFallsBackForInvalidValues() {
  for (const value of [undefined, "", "   ", "abc", "-1", "1.5", "65536", "Infinity"]) {
    assert.equal(parseLocalServerPort(value), DEFAULT_PLANNER_PORT);
  }
}

function testPortParsingAcceptsValidValues() {
  assert.equal(parseLocalServerPort("0"), 0);
  assert.equal(parseLocalServerPort("4174"), 4174);
  assert.equal(parseLocalServerPort(" 65535 "), 65535);
}

function testPositiveIntegerConfigParsing() {
  assert.equal(parsePositiveIntegerConfig(undefined, DEFAULT_MAX_RUNNING_SOLVES), DEFAULT_MAX_RUNNING_SOLVES);
  assert.equal(parsePositiveIntegerConfig("", DEFAULT_MAX_RUNNING_SOLVES), DEFAULT_MAX_RUNNING_SOLVES);
  assert.equal(parsePositiveIntegerConfig("abc", DEFAULT_MAX_RUNNING_SOLVES), DEFAULT_MAX_RUNNING_SOLVES);
  assert.equal(parsePositiveIntegerConfig("0", DEFAULT_MAX_RUNNING_SOLVES), 1);
  assert.equal(parsePositiveIntegerConfig("2.9", DEFAULT_MAX_RUNNING_SOLVES), 2);
}

function testPositiveMillisecondsFromSecondsConfigParsing() {
  assert.equal(
    parsePositiveMillisecondsFromSecondsConfig(undefined, DEFAULT_PROGRESS_LOG_INTERVAL_SECONDS),
    DEFAULT_PROGRESS_LOG_INTERVAL_SECONDS * 1000
  );
  assert.equal(
    parsePositiveMillisecondsFromSecondsConfig("abc", DEFAULT_PROGRESS_LOG_INTERVAL_SECONDS),
    DEFAULT_PROGRESS_LOG_INTERVAL_SECONDS * 1000
  );
  assert.equal(parsePositiveMillisecondsFromSecondsConfig("0", DEFAULT_PROGRESS_LOG_INTERVAL_SECONDS), 1000);
  assert.equal(parsePositiveMillisecondsFromSecondsConfig("2.9", DEFAULT_PROGRESS_LOG_INTERVAL_SECONDS), 2000);
}

testPortParsingFallsBackForInvalidValues();
testPortParsingAcceptsValidValues();
testPositiveIntegerConfigParsing();
testPositiveMillisecondsFromSecondsConfigParsing();
