# redis-delayed-tasks

[![Node.js CI](https://github.com/knation/node-redis-delayed-tasks/actions/workflows/node.js.yml/badge.svg)](https://github.com/knation/node-redis-delayed-tasks/actions/workflows/node.js.yml) [![Coverage Status](https://coveralls.io/repos/github/knation/node-redis-delayed-tasks/badge.svg?branch=main)](https://coveralls.io/github/knation/node-redis-delayed-tasks?branch=main) [![Dependencies](https://david-dm.org/knation/node-redis-delayed-tasks.svg)](https://david-dm.org/knation/node-redis-delayed-tasks)

This node module allows for the simple future execution of tasks utilizing redis as a datastore. It takes away the need to mess with redis or some other message queue and provides a way to do _something_ in the future in a distributed environment.

The task callback is unaware of the context of your codebase. Instead of calling a specific callback function per task, this module calls the same callback function for each task, relying on you to route it to the appropriate place.

Possible use cases include:
* Retry logic (with or without backoff).
* Delaying a task wherein using `setTimeout` introduces a risk if the application crashes.
* Distributing future tasks across multiple workers.


## Usage

Create a new `DelayedTasks` object:
```javascript
const { DelayedTasks } = require('redis-delayed-tasks');

const dt = new DelayedTasks({
  id: 'delayed-queue-1',
  redis: {
    host: '127.0.0.1',
    port: 6379
  },
  callback: (data, taskId, dueTime) => {
    // `data` is the JSON.stringify-able data provided when the task was added
    // `taskId` is the generated ID of the task to process
    // `dueTime` is the epoch (milliseconds) of when the task was due
  }
});

// Start polling
dt.start();

const newTaskId = await dt.add(2000, { foo: 'bar' });

// Don't forget to clean up later: `dt.stop()`
```

## Example: HTTP Retry

Handling HTTP retries is a common use case that requires waiting a certain amount of time before retrying a request. You could use `setTimeout`, but if the application dies before the timeout function is called, you lose the request entirely.

Instead, we'll use our `DelayedTasks` queue to delay the task in a persisted manner until it's time to retry again.

```javascript
const { DelayedTasks } = require('redis-delayed-tasks');

const dt = new DelayedTasks({
  id: 'http-retry',
  redis: {
    host: '127.0.0.1',
    port: 6379
  },
  callback: function (data, taskId, dueTime) {
    // A task is ready to be tried again
    try {
      request(data);

    } catch (e) {
      // It failed again, try in another 5 seconds
      this.add(5000, data);
    }
  }
});

// Start polling
dt.start();

try {
  // `request` would be your http request library of choice
  request({
    method: 'POST',
    url: '/foo',
    data: { foo: 'bar' }
  });

} catch (e) {
  // There was an error, try again in 5 seconds
  this.add(5000, data);
}

// Don't forget to clean up later: `dt.stop()`
```


## Methods


### constructor

The constructor takes a single object. Properties are as follows:

| Property                 | Description                                                                                                                                                         | Required | Default |
|--------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|---------|
| `id`                     | ID of the queue. This is used as a redis key, so it should be shared amongst any workers that operate within the same group. Think of it as a "consumer group" id.  | Yes      |         |
| `redis`                  | An existing redis client to use OR connection settings for a new redis client<sup>1</sup>.                                                                                  | Yes      |         |
| `callback`               | The function to call when tasks are due. <br><br>When a task is due or past-due, your callback method is called asynchronously, passing the `data` you provided when adding, the generated `taskId`, and the time (in ms) that the task was due.<br><br>The context of `this` is the `DelayedTasks` object.                                                                                                                           | Yes      |         |
| `options.pollIntervalMs` | How often to poll redis for tasks due (in milliseconds). The shorter the interval, the sooner after being due a task will be processed, but the more load in redis. | No       | 1000    |

<sup>1</sup> This module uses `node_redis` under the hood and supports versions < 4.0.0. If you're using a redis client or connection data compatible with `node_redis@4.*`, it will not work.

### start / stop polling

To begin polling for tasks, call `dt.start()`. To pause or to clean up, call `dt.stop()` to stop future polling.

### add(_delayMs_, _data_)

Adds a task to be executed `delayMs` millseconds in the future. `data` can be any JSON.stringify-able data that will get passed to `callback` when the task is due.

This function returns a promise that resolves to a generated UUID of the task. It is returned _after_ the task is saved to redis, so if you want to add asynchronously and/or don't care about the generated ID, you can call the function asynchronously

**Example**

Add a task to be processed 30 seconds in the future:
```javascript
const newTaskId = await dt.add(30000, { foo: 'bar' });

// or asynchronously
dt.add(30000, { foo: 'bar' });
```

### poll()

To force a poll outside of the poll interval, call `dt.poll()`. This should be used with caution as it could potentially interfere with an active poll, therefore causing a transaction conflict in redis.


## Notes

### When tasks are processed

Tasks that are due are not processed immediately when due. Instead, they will be processed on the next poll interval. So, we recommend making the poll interval shorter if you care about processing tasks quicker after they're due.

Otherwise, if you just want to make sure it gets done _sometime_ around when it's due, make the poll interval longer to give redis a break.

### Redis transaction conflicts

If the redis key is updated during the internal `poll()` call, we do not retry and, instead, wait for the next poll interval. Since polling intervals can be very short, we don't want to end up overlapping.

## Future work

* This module performs minimal error catching outside of required parameters for this module. This may
be improved in the future. For now, we recommend surrounding with try-catch to
catch everything, including redis errors.

* Possibly promisify all redis functions. At the moment, it's not worth the effort
for minimal use and isn't worth the overhead of promised functions.

* Trap errors from `callback()`

* Add coverage for redis errors. This is currently ignored via comments since `fakeredis` is used to mock redis.

* Ability to cancel a task by ID or data. Will wait until there's a genuine desire for this. For now, we'll assume that a task won't be added until it _should_ run in the future.

* Add a flag when the class is polling to prevent conflicts on explicit polls.

## License
MIT License
