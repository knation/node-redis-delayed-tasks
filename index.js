
const redis = require('redis');
const { v1: uuidv1 } = require('uuid');

class DelayedTasks {

  constructor(settings = {}) {

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

    // Poll size - how many items to pop off redis on each poll (Default: 10)
    if (typeof settings.options.pollSize === 'number' && settings.options.pollSize > 0) {
      this.pollSize = settings.options.pollSize;
    } else {
      this.pollSize = 10;
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
  async poll() {
    const now = new Date().getTime();

    // Pop `this.pollSize` number of tasks from the queue
    const tasks = await new Promise((resolve, reject) => {
      this.redisClient.zpopmin(this.redisKey, this.pollSize, (err, tasks) => {
        if (err) {
          reject(err);
        } else {
          resolve(tasks.map(t => JSON.parse(t)));
        }
      });
    });

    // Iterate tasks and stop at future tasks
    for (const task of tasks) {
      if (task.delayedTime <= now) {
        // Pass this task to the callback method
        this.callback.call(null, task.id, task.delayUntil, task.data);
      } else {
        // Add this task back into redis
        this.addToRedis(task.delayUntil, JSON.stringify(task));
      }
    }
  }

  /**
   * Adds a task to redis.
   */
  addToRedis(delayedTime, task) {
    return new Promise((resolve, reject) => {
      this.redisClient.zadd(this.redisKey, delayedTime, task, (err, result) => {
        err ? reject(err) : resolve(result);
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
      delayUntil: delayedTime,
      data
    });

    await this.addToRedis(delayedTime, task);

    return taskId;
  }

}

exports.DelayedTasks = DelayedTasks;
