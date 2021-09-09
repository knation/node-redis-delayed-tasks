const assert = require('assert');
const sinon = require('sinon');
const fakeredis = require('fakeredis');
const redis = require('redis');
const { validate: uuidValidate } = require('uuid');

const { DelayedTasks } = require('../index');

/**
 * Checks that the supplied `DelayedTasks` object is valid.
 */
function isValidTasksObject(dt) {
  assert.ok(dt.id);
  assert.ok(dt.redisClient);
  assert.ok(dt.redisKey);
  assert.ok(dt.pollIntervalMs);
  assert.ok(dt.pollSize);
  assert.equal(dt.pollIntervalId, null);
}

/**
 * Creates a standard, redis-mocked `DelayedTasks` object.
 */
function createTasksObject(callback) {
  const client = redis.createClient();

  const dt = new DelayedTasks({
    redis: client,
    id: 'test',
    callback: callback || (() => {})
  });

  // Replace client with mock
  dt.redisClient.quit();
  dt.redisClient = fakeredis.createClient();

  return dt;
}

/**
 * This is pretty much just a wrapper method for `zrangebyscore`, wrapped in
 * a promise.
 */
function getTasksUntil(dt, end) {
  return new Promise((resolve, reject) => {

    dt.redisClient.zrange(dt.redisKey, 0, end, (err, tasks) => {
      if (err) {
        reject(err);
      } else {
        resolve(tasks.map(t => JSON.parse(t)));
      }
    });
  });
}

describe('constructor', function() {

  it('should create redis client with existing client', function() {
    const client = redis.createClient();

    const dt = new DelayedTasks({
      redis: client,
      id: 'test',
      callback: () => {}
    });

    client.quit();

    isValidTasksObject(dt);

    client.quit();
  });

  it('should create redis client with provided object', function() {
    const dt = new DelayedTasks({
      redis: {},
      id: 'test',
      callback: () => {}
    });

    isValidTasksObject(dt);

    dt.redisClient.quit();
  });

  it('fails when redis object is missing', function() {
    assert.throws(
      () => {
        try {
          const dt = new DelayedTasks({
            id: 'test',
            callback: () => {}
          });
        } catch (e) {
          throw e;
        }
      },
      {
        name: 'TypeError',
        message: 'Invalid redis connection options'
      }
    );
  });

  it('fails when an invalid redis object is provided', function() {
    assert.throws(
      () => {
        try {
          const dt = new DelayedTasks({
            redis: false,
            id: 'test',
            callback: () => {}
          });
        } catch (e) {
          throw e;
        }
      },
      {
        name: 'TypeError',
        message: 'Invalid redis connection options'
      }
    );
  });

  it('fails when an invalid callback is provided', function() {
    assert.throws(
      () => {
        const client = redis.createClient();

        try {
          const dt = new DelayedTasks({
            redis: client,
            id: 'test',
            callback: true
          });
        } catch (e) {
          throw e;
        } finally {
          client.quit();
        }
      },
      {
        name: 'TypeError',
        message: 'Invalid callback function specified'
      }
    );
  });

  it('fails when id is missing', function() {
    assert.throws(
      () => {
        const client = redis.createClient();

        try {
          const dt = new DelayedTasks({
            redis: client,
            callback: () => {}
          });
        } catch (e) {
          throw e;
        } finally {
          client.quit();
        }
      },
      {
        name: 'TypeError',
        message: 'Invalid queue ID specified'
      }
    );
  });

  it('fails when id is invalid', function() {
    assert.throws(
      () => {
        const client = redis.createClient();

        try {
          const dt = new DelayedTasks({
            id: true,
            redis: client,
            callback: () => {}
          });
        } catch (e) {
          throw e;
        } finally {
          client.quit();
        }
      },
      {
        name: 'TypeError',
        message: 'Invalid queue ID specified'
      }
    );
  });

  it('uses default `pollIntervalMs` if invalid', function() {
    const dt = new DelayedTasks({
      id: 'test',
      redis: {},
      callback: () => {},
      options: {
        pollIntervalMs: true
      }
    });

    isValidTasksObject(dt);
    assert.equal(dt.pollIntervalMs, 1000);

    dt.redisClient.quit();
  });

  it('allows for a custom `pollIntervalMs` value', function() {
    const dt = new DelayedTasks({
      id: 'test',
      redis: {},
      callback: () => {},
      options: {
        pollIntervalMs: 100
      }
    });

    isValidTasksObject(dt);
    assert.equal(dt.pollIntervalMs, 100);

    dt.redisClient.quit();
  });

  it('uses default `pollSize` if invalid', function() {
    const dt = new DelayedTasks({
      id: 'test',
      redis: {},
      callback: () => {},
      options: {
        pollSize: true
      }
    });

    isValidTasksObject(dt);
    assert.equal(dt.pollSize, 10);

    dt.redisClient.quit();
  });

  it('allows for a custom `pollSize` value', function() {
    const dt = new DelayedTasks({
      id: 'test',
      redis: {},
      callback: () => {},
      options: {
        pollSize: 20
      }
    });

    isValidTasksObject(dt);
    assert.equal(dt.pollSize, 20);

    dt.redisClient.quit();
  });

});

describe('add()', function() {

  it('fails with an invalid delay', async function() {
    const dt = createTasksObject();

    try {
      await dt.add(false, {});
      assert.fail('The expected error was not thrown');

    } catch (e) {
      assert.throws(
        () => {throw e},
        {
          name: 'TypeError',
          message: '`delayMs` must be a positive integer'
        }
      );
    }
  });

  it('fails with a non-positive delay', async function() {
    const dt = createTasksObject();

    try {
      await dt.add(0, {});
      assert.fail('The expected error was not thrown');

    } catch (e) {
      assert.throws(
        () => {throw e},
        {
          name: 'TypeError',
          message: '`delayMs` must be a positive integer'
        }
      );
    }
  });

  it('fails with an undefined data object', async function() {
    const dt = createTasksObject();

    try {
      await dt.add(1);
      assert.fail('The expected error was not thrown');

    } catch (e) {
      assert.throws(
        () => {throw e},
        {
          name: 'TypeError',
          message: 'No value provided for `data`'
        }
      );
    }
  });

  it('fails with a null data object', async function() {
    const dt = createTasksObject();

    try {
      await dt.add(1, null);
      assert.fail('The expected error was not thrown');

    } catch (e) {
      assert.throws(
        () => {throw e},
        {
          name: 'TypeError',
          message: 'No value provided for `data`'
        }
      );
    }
  });

  it('adds delayed tasks', async function() {
    const dt = createTasksObject();

    const now = new Date().getTime();

    const tasksToAdd = [
      {
        delay: 10000,
        data: { foo: 'bar' }
      },
      {
        delay: 25000,
        data: { foo: 'baz' }
      },
      {
        delay: 15000,
        data: { foo: 'ban' }
      },
      {
        delay: 100,
        data: { foo: 'first' }
      }
    ];

    let maxDelay = 0;
    try {

      // Add all test tasks
      for (let i=0;i<tasksToAdd.length;i++) {
        tasksToAdd[i].id = await dt.add(tasksToAdd[i].delay, tasksToAdd[i].data);

        // Validate ID
        assert.ok(uuidValidate(tasksToAdd[i].id));

        if (tasksToAdd[i].delay > maxDelay) {
          maxDelay = tasksToAdd[i].delay;
        }
      }

    } catch (e) {
      console.error(e);
      assert.fail('Unexpected error');
    }

    const tasks = await getTasksUntil(dt, new Date().getTime() + maxDelay);

    // Check total results
    assert.equal(tasks.length, tasksToAdd.length);

    // Sort `tasksToAdd` by delay time to match result from zrange
    tasksToAdd.sort((a, b) => (a.delay <= b.delay) ? -1 : 1);

    // Check all time-sorted results
    for (let i=0;i<tasks.length;i++) {
      assert.equal(tasks[i].id, tasksToAdd[i].id);
      assert.deepEqual(tasks[i].data, tasksToAdd[i].data);

      // NOTE: We can't accurately check the `delayUntil` property from redis
      // because the clock may change during the test. That said, `poll()` tests
      // later on will confirm that the zset works correctly.
    }
  });

});

describe('start/stop', function() {

  it('starts/stops the polling', function() {
    const dt = createTasksObject();

    // Should be null after init
    assert.equal(dt.pollIntervalId, null);

    // Is the interval ID after start()
    dt.start();
    assert.ok(dt.pollIntervalId);

    // Is empty after stop
    dt.stop();
    assert.equal(dt.pollIntervalId, null);
  });

});

xdescribe('poll', function() {

  it('works with no delayed tasks', async function() {
    const cb = sinon.stub();
    const dt = createTasksObject(cb);

    // For good measure, make sure we're not starting with any tasks
    let tasks = await getTasksUntil(dt, new Date().getTime() + 10000);

    await dt.poll();

    // Ensure that we didn't process any tasks
    assert.equal(cb.callCount, 0);

    // Ensure that no tasks were added back
      tasks = await getTasksUntil(dt, new Date().getTime() + 10000);
    assert.equal(tasks.length, 0);
  });

});
