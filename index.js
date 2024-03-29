
const redis = require('redis');
const { v1: uuidv1 } = require('uuid');

class DelayedTasks {

  constructor(settings) {

    if (typeof settings !== 'object') {
      throw new TypeError('No constructor settings specified');
    }

    // Check ID
    if (typeof settings.id === 'string') {
      this.id = settings.id;
    } else {
      throw new TypeError('Invalid queue ID specified');
    }

    // Will be set to true if the redis instance is self-contained
    this.selfContainedResis = false;

    if (typeof settings.redis?.connect === 'function') {
      this.redisClient = settings.redis;

    } else if (typeof settings.redis === 'object') {
      settings.redis.legacyMode = true;
      this.redisClient = redis.createClient(settings.redis);
      this.selfContainedResis = true;
      this.redisClient.on("error", function(error) {
        // todo: do something with this
      });

    } else {
      throw new TypeError('Invalid redis connection options');
    }


    // Callback function for all delayed tasks
    if (typeof settings.callback === 'function') {
      this.callback = settings.callback;
    } else {
      throw new TypeError('Invalid callback function specified');
    }

    // Create the queue name (will be the redis key for the ZSET)
    this.redisKey = `delayed:${ this.id }`;

    // Force a settings object
    settings.options = settings.options || {};

    // Poll Interval - how often to poll redis (Default: 1000ms)
    if (typeof settings.options.pollIntervalMs === 'number' && settings.options.pollIntervalMs > 0) {
      this.pollIntervalMs = settings.options.pollIntervalMs;
    } else {
      this.pollIntervalMs = 1000;
    }

    this.pollIntervalId = null;
  }

  connect() {
    if (!this.redisClient.isReady) {
      const p = new Promise(resolve => this.redisClient.on('ready', resolve));

      this.redisClient.connect();

      return p;

    } else {
      // Already connected -- nothing to do and no failure
      return Promise.resolve();
    }
  }

  /**
   * Start polling.
   */
  start() {
    if (this.redisClient.isReady) {
      this.pollIntervalId = setInterval(this.poll.bind(this), this.pollIntervalMs);
      return true;

    } else {
      return false;
    }
  }

  /**
   * Stops polling.
   */
  stop() {
    clearInterval(this.pollIntervalId);
    this.pollIntervalId = null;
  }

  /**
   * Closes up shop. If the redis instance is self contained (it was created,
   * just for this object instance), it will be deleted.
   */
  async close() {
    this.stop();

    if (this.selfContainedResis && this.redisClient.isReady) {
      await this.redisClient.disconnect();
      this.redisClient = null;
    }
  }

  /**
   * Polls redis for tasks.
   */
  poll() {
    const now = new Date().getTime();

    return new Promise((resolve, reject) => {
      this.redisClient.watch(this.redisKey, (watchError) => {
        /* istanbul ignore next */
        if (watchError) return reject(watchError);

        this.redisClient.zrangebyscore(this.redisKey, 0, now, (zrangeErr, tasks) => {
          /* istanbul ignore next */
          if (zrangeErr) return reject(zrangeErr);

          if (tasks.length > 0) {
            this.redisClient
              .multi()
              .zremrangebyscore(this.redisKey, 0, now)
              .exec((execError, results) => {
                /* istanbul ignore next */
                if (execError) {
                  if (execError instanceof redis.WatchError) {
                    /**
                     * If execError is a "WatchError", it means that a concurrent client
                     * changed the key while we were processing it and thus
                     * the execution of the MULTI command was not performed. We'll fail
                     * silently as those jobs will be picked up on the next `poll()`
                     */
                    return resolve(0);
                  } else {
                    return reject(execError)
                  }
                }

                if (results && results[0] !== null) {
                  // Process tasks
                  tasks
                    .map(t => JSON.parse(t))
                    .forEach(t => this.callback.call(this, t.data, t.id, t.due));
                }

                resolve((!results || results[0] === null) ? 0 : results[0]);
              });

            } else {
              // No changes to make
              this.redisClient.unwatch();
              resolve(0);
            }
        });
      });
    });
  }

  /**
   * Adds a task to redis.
   */
  addToRedis(delayedTime, task) {
    return new Promise((resolve, reject) => {
      this.redisClient.zadd(this.redisKey, delayedTime, task, (err, result) => {
        /* istanbul ignore next */
        if (err) return reject(err);

        resolve(result);
      });
    });
  }

  /**
   * Add a delayed task.
   */
  async add(delayMs, data) {
    // Validate `delayMs`
    if (typeof delayMs !== 'number' || delayMs <= 0) {
      throw new TypeError('`delayMs` must be a positive integer');
    } else if (data === undefined || data === null) {
      throw new TypeError('No value provided for `data`');
    }

    // Set time to execute
    const delayedTime = new Date().getTime() + delayMs;

    // Create unique task ID
    const taskId = uuidv1();

    // Serialize data
    const task = JSON.stringify({
      id: taskId,
      due: delayedTime,
      data
    });

    await this.addToRedis(delayedTime, task);

    return taskId;
  }

}

exports.DelayedTasks = DelayedTasks;
