const assert = require('assert');
const fakeredis = require('fakeredis');
const redis = require('redis');

const { DelayedTasks } = require('../index');

function isValidTasksObject(dt) {
  assert.ok(dt.redisClient);
  assert.ok(dt.queueId);
  assert.ok(dt.setName);
  assert.ok(dt.pollIntervalMs);
}

describe('constructor', function() {

  it('should create redis client with existing client', function() {
    // const client = fakeredis.createClient();
    const client = redis.createClient();

    const dt = new DelayedTasks(client, { callback: () => {} });

    isValidTasksObject(dt);

    client.quit();
  });

  it('should create redis client with provided object', function() {
    const dt = new DelayedTasks({}, { callback: () => {} });

    isValidTasksObject(dt);

    dt.redisClient.quit();
  });

  it('fails when an invalid object is provided', function() {
    assert.throws(
      () => {
        try {
          const dt = new DelayedTasks(false, { callback: () => {} });
        } catch (e) {
          throw e;
        }
      },
      {
        name: 'TypeError',
        message: 'Invalid redis connection options'
      }
    )
  });

  it('uses default `pollIntervalMs` if invalid', function() {
    const dt = new DelayedTasks({}, { callback: () => {}, pollIntervalMs: false });

    isValidTasksObject(dt);

    dt.redisClient.quit();
  });

});
