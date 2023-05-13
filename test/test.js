const assert = require('assert');
const sinon = require('sinon');
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
  assert.equal(dt.pollIntervalId, null);
}

/**
 * Creates a standard, redis-mocked `DelayedTasks` object.
 */
async function createTasksObject(callback) {
  const client = redis.createClient({
    legacyMode: true
  });

  const dt = new DelayedTasks({
    redis: client,
    id: 'test',
    callback: callback || (() => {})
  });

  await dt.connect();

  await clearQueue(dt)

  return dt;
}

/**
 * Clears the queue for the given object.
 */
function clearQueue(dt) {
  return new Promise((resolve, reject) => {
    dt.redisClient.zremrangebyscore(dt.redisKey, '-inf', 'inf', (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
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
    const client = redis.createClient({
      legacyMode: true
    });

    const dt = new DelayedTasks({
      redis: client,
      id: 'test',
      callback: () => {}
    });

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

  it('fails when no settings provided', function() {
    assert.throws(
      () => {
        try {
          const dt = new DelayedTasks();
        } catch (e) {
          throw e;
        }
      },
      {
        name: 'TypeError',
        message: 'No constructor settings specified'
      }
    );
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
        const client = redis.createClient({
          legacyMode: true
        });

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
        const client = redis.createClient({
          legacyMode: true
        });

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
        const client = redis.createClient({
          legacyMode: true
        });

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

});

describe('add()', function() {

  it('fails with an invalid delay', async function() {
    const dt = await createTasksObject();

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
    } finally {
      dt.close()
    }
  });

  it('fails with a non-positive delay', async function() {
    const dt = await createTasksObject();

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
    } finally {
      dt.close()
    }
  });

  it('fails with an undefined data object', async function() {
    const dt = await createTasksObject();

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
    } finally {
      dt.close()
    }
  });

  it('fails with a null data object', async function() {
    const dt = await createTasksObject();

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
    } finally {
      dt.close()
    }
  });

  it('adds delayed tasks', async function() {
    const dt = await createTasksObject();

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

      // NOTE: We can't accurately check the `due` property from redis
      // because the clock may change during the test. That said, `poll()` tests
      // later on will confirm that the zset works correctly.
    }

    dt.close()
  });

});

it('start/stop/close', async function() {
  const dt = await createTasksObject();

  // Should be null after init
  assert.equal(dt.pollIntervalId, null);

  // Is the interval ID after start()
  await dt.start();
  assert.ok(dt.pollIntervalId);

  // Is empty after stop
  dt.stop();
  assert.equal(dt.pollIntervalId, null);

  // Start again
  dt.start();
  assert.ok(dt.pollIntervalId);

  // Close and test interval again
  dt.close();
  assert.equal(dt.pollIntervalId, null);
});

describe('poll', function() {

  it('works with no delayed tasks', async function() {
    const cb = sinon.stub();
    const dt = await createTasksObject(cb);

    const tasksRemoved = await dt.poll();

    // Ensure that we didn't process any tasks
    assert.equal(tasksRemoved, 0);
    assert.equal(cb.callCount, 0);

    // Ensure that all tasks were removed
    tasks = await getTasksUntil(dt, new Date().getTime() + 100000000);
    assert.equal(tasks.length, 0);

    dt.close()
  });

  it('works when all delayed tasks are due', async function() {
    const cb = sinon.stub();
    const dt = await createTasksObject(cb);

    // Add some tasks
    const tasksToAdd = [
      {
        delay: 100,
        data: { foo: 'bar' }
      },
      {
        delay: 300,
        data: { foo: 'baz' }
      },
      {
        delay: 200,
        data: { foo: 'ban' }
      },
      {
        delay: 50,
        data: { foo: 'first' }
      }
    ];

    let maxDelay = 0;
    try {

      // Add all test tasks
      for (let i=0;i<tasksToAdd.length;i++) {
        tasksToAdd[i].id = await dt.add(tasksToAdd[i].delay, tasksToAdd[i].data);

        if (tasksToAdd[i].delay > maxDelay) {
          maxDelay = tasksToAdd[i].delay;
        }
      }

    } catch (e) {
      console.error(e);
      assert.fail('Unexpected error');
    }

    // Wait for tasks to come due
    await new Promise(r => setTimeout(r, maxDelay + 1));

    const tasksRemoved = await dt.poll();

    // Check that tasks were processed
    assert.equal(tasksRemoved, tasksToAdd.length);
    assert.equal(cb.callCount, tasksToAdd.length);
    tasksToAdd.forEach(t => assert.equal(cb.calledWith(t.data, t.id), true));

    // Ensure that all tasks were removed
    tasks = await getTasksUntil(dt, new Date().getTime() + 100000000);
    assert.equal(tasks.length, 0);

    dt.close()
  });

  it('works when some delayed tasks are due', async function() {
    const cb = sinon.stub();
    const dt = await createTasksObject(cb);

    // Add some tasks
    const tasksToAdd = [
      {
        delay: 100,
        data: { foo: 'bar' }
      },
      {
        delay: 300,
        data: { foo: 'baz' }
      },
      {
        delay: 200,
        data: { foo: 'ban' }
      },
      {
        delay: 50,
        data: { foo: 'first' }
      }
    ];

    let maxDelay = 0;
    try {

      // Add all test tasks
      for (let i=0;i<tasksToAdd.length;i++) {
        tasksToAdd[i].id = await dt.add(tasksToAdd[i].delay, tasksToAdd[i].data);

        if (tasksToAdd[i].delay > maxDelay) {
          maxDelay = tasksToAdd[i].delay;
        }
      }

    } catch (e) {
      console.error(e);
      assert.fail('Unexpected error');
    }

    // ADD 2 MORE TASKS DUE MUCH LATER
    await Promise.all([
      dt.add(10000, { deferred: 1 }),
      dt.add(11000, { deferred: 2 })
    ]);

    // Wait for tasks to come due
    await new Promise(r => setTimeout(r, maxDelay + 1));

    const tasksRemoved = await dt.poll();

    // Check that tasks were processed
    assert.equal(tasksRemoved, tasksToAdd.length);
    assert.equal(cb.callCount, tasksToAdd.length);
    tasksToAdd.forEach(t => assert.equal(cb.calledWith(t.data, t.id), true));

    // Ensure that correct tasks were removed
    tasks = await getTasksUntil(dt, new Date().getTime() + 100000000);
    assert.equal(tasks.length, 2);
    assert.deepEqual(tasks[0].data, { deferred: 1 });
    assert.deepEqual(tasks[1].data, { deferred: 2 });

    dt.close()
  });

  it('works when all tasks are delayed', async function() {
    const cb = sinon.stub();
    const dt = await createTasksObject(cb);

    // Add some tasks
    const tasksToAdd = [
      {
        delay: 1000,
        data: { foo: 'bar' }
      },
      {
        delay: 3000,
        data: { foo: 'baz' }
      },
      {
        delay: 2000,
        data: { foo: 'ban' }
      },
      {
        delay: 500,
        data: { foo: 'first' }
      }
    ];

    try {

      // Add all test tasks
      for (let i=0;i<tasksToAdd.length;i++) {
        tasksToAdd[i].id = await dt.add(tasksToAdd[i].delay, tasksToAdd[i].data);
      }

    } catch (e) {
      console.error(e);
      assert.fail('Unexpected error');
    }

    // Process immediately so that no tasks are processed
    const tasksRemoved = await dt.poll();

    // Check that tasks were processed
    assert.equal(tasksRemoved, 0);
    assert.equal(cb.callCount, 0);

    // Ensure that correct tasks were removed
    tasks = await getTasksUntil(dt, new Date().getTime() + 100000000);
    assert.equal(tasks.length, 4);

    dt.close()
  });

  it('elegantly fails if key is updated during poll', async function() {
    const cb = sinon.stub();
    const dt = await createTasksObject(cb);

    // Add some tasks
    const tasksToAdd = [
      {
        delay: 100,
        data: { foo: 'bar' }
      },
      {
        delay: 300,
        data: { foo: 'baz' }
      },
      {
        delay: 200,
        data: { foo: 'ban' }
      },
      {
        delay: 50,
        data: { foo: 'first' }
      }
    ];

    let maxDelay = 0;
    try {

      // Add all test tasks
      for (let i=0;i<tasksToAdd.length;i++) {
        tasksToAdd[i].id = await dt.add(tasksToAdd[i].delay, tasksToAdd[i].data);

        if (tasksToAdd[i].delay > maxDelay) {
          maxDelay = tasksToAdd[i].delay;
        }
      }

    } catch (e) {
      console.error(e);
      assert.fail('Unexpected error');
    }

    // Wait for tasks to come due
    await new Promise(r => setTimeout(r, maxDelay + 1));

    // Poll asynchronously
    const pollPromise = dt.poll();

    // Add another task while we're polling
    dt.add(1000, {})

    const tasksRemoved = await pollPromise;

    // Check that tasks were processed
    assert.equal(tasksRemoved, 0);
    assert.equal(cb.callCount, 0);

    // All tasks should be remaining since there was a redis transaction conflict
    tasks = await getTasksUntil(dt, new Date().getTime() + 100000000);

    /// NOTE: This is 5 now because we added another during polling
    assert.equal(tasks.length, 5);

    dt.close()
  });

});
