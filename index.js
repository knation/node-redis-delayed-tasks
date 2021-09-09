
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

    if (settings.redis instanceof redis.RedisClient) {
      this.redisClient = settings.redis;
    } else if (typeof settings.redis === 'object') {
      this.redisClient = redis.createClient(settings.redis);
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

  /**
   * Start polling.
   */
  start() {
    this.pollIntervalId = setInterval(this.poll.bind(this), this.pollIntervalMs);
  }

  /**
   * Stops polling.
   */
  stop() {
    clearInterval(this.pollIntervalId);
    this.pollIntervalId = null;
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
                if (execError) return reject(execError);

                // Success, either that the update was made, or the key changed

                if (results[0] !== null) {
                  // Process tasks
                  tasks
                    .map(t => JSON.parse(t))
                    .forEach(t => this.callback.call(null, t.data, t.id, t.due));
                }

                resolve(results[0] ?? 0);

                /**
                 * If results === null, it means that a concurrent client
                 * changed the key while we were processing it and thus
                 * the execution of the MULTI command was not performed.
                 *
                 * NOTICE: Failing an execution of MULTI is not considered
                 * an error. So you will have err === null and results === null
                 */
              });

            } else {
              // No changes to make, so discard the transaction
              this.redisClient.discard();
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
