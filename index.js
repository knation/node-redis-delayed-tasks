
const redis = require('redis');
const { promisifyAll } = require('bluebird');
const { v1: uuidv1 } = require('uuid');

promisifyAll(redis);

class DelayedTasks {

  constructor(redisConn, settings = {}) {

    if (redisConn instanceof redis.RedisClient) {
      this.redisClient = redisConn;
    } else if (typeof redisConn === 'object') {
      this.redisClient = redis.createClient(redisConn);
    } else {
      throw new TypeError('Invalid redis connection options');
    }

    // Callback function for all delayed tasks
    if (typeof settings.callback === 'function') {
      this.callback = settings.callback;
    } else {
      throw new TypeError('Invalid callback function specified');
    }

    // Generate a unique queue ID
    this.queueId = uuidv1();
    this.setName = `delayed:${ this.queueId }`;

    // Poll Interval - how often to poll redis (Default: 1000ms)
    if (!isNaN(settings.pollIntervalMs) && settings.pollIntervalMs > 0) {
      this.pollIntervalMs = settings.pollIntervalMs;
    } else {
      this.pollIntervalMs = 1000;
    }
  }

  /**
   * Start polling.
   */
  start() {
    this.interval = setInterval(this.pollIntervalMs, this.poll.bind(this));
  }

  /**
   * Stops polling.
   */
  stop() {
    clearInterval(this.interval);
  }

  /**
   * Polls redis for tasks.
   */
  async poll() {
    const now = new Date().getTime();

    const tasks = await this.redisClient.zrangebyscoreAsync(this.setName, 0, now);
    console.log(tasks);
  }

  /**
   * Add a delayed task.
   */
  async add(delayMs, data) {
    // Validate `delayMs`
    if (isNaN(delayMs) || delayMs <= 0) {
      throw new Error('`delayMs` must be a positive integer');
    }

    // Set time to execute
    const delayedTime = new Date().getTime() + delayMs;

    // Create unique task ID
    const taskId = uuidv1();

    // Serialize data
    const key = JSON.stringify({
      id: taskId,
      data
    });

    await this.redisClient.zaddAsync(this.setName, delayedTime, key);

    return taskId;
  }

}

exports.DelayedTasks = DelayedTasks;
