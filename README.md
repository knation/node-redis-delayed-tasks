# redis-delayed-tasks

[![Node.js CI](https://github.com/knation/node-redis-delayed-tasks/actions/workflows/node.js.yml/badge.svg)](https://github.com/knation/node-redis-delayed-tasks/actions/workflows/node.js.yml) [![Coverage Status](https://coveralls.io/repos/github/knation/node-redis-delayed-tasks/badge.svg?branch=main)](https://coveralls.io/github/knation/node-redis-delayed-tasks?branch=main) [![Dependencies](https://david-dm.org/knation/node-redis-delayed-tasks.svg)](https://david-dm.org/knation/node-redis-delayed-tasks)

This node module allows for the simple future execution of tasks utilizing redis as a datastore. It takes away the need to mess with redis or some other message queue and provides a way to do _something_ in the future in a distributed environment.

The task callback is unaware of the context of your codebase. Instead of calling a specific callback function per task, this module calls the same callback function for each task, relying on you to route it to the appropriate place.

Possible use cases include:
* Retry logic (with or without backoff).
* Delaying a task wherein using `setTimeout` introduces a risk if the application crashes.
* Distributing future tasks across multiple workers.

## Installation

```bash
npm i redis-delayed-tasks
```

## Upgrading from v1 to v2

Version 2 does not introduce any new features, but rather uses `node-redis` v4 under the hood and therefore could incorporate breaking changes if you're using an older version of the redis library elsewhere. The library is instantiated the same way and just requires an additional line afterwards: `await dt.connect()`.


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

// Connect to redis (new in v2)
await dt.connect()

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

// Don't forget to clean up later: `dt.stop()` or `dt.close()`, as applicable
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

<sup>1</sup> This module uses [`node-redis`](https://github.com/redis/node-redis) version 4 under the hood in legacy mode. If you provide your own client, you're responsible for connecting, disconnecting, and creating an error handler.

### Connect

If you provided an object with options for connecting to redis, you must call `await dt.connect()` to connect to redis before doing anything else. If you've provided an existing, connected redis client, this is not necessary.

### start / stop polling

To begin polling for tasks, call `dt.start()`. This returns a boolean with the status of starting. If `false`, it's because the redis client hasn't been connected yet. If this was a self-supplied client, call `await client.connect()`. Otherwise, call `await dt.connect()` to create the connection.

Call `dt.stop()` to stop future polling.

### close()

Calling `await dt.close()` will stop polling. If a new redis client was created for the object instance (that is, it was passed an object of configuration details), that redis client will be closed, too (using `disconnect()` to abort pending requests). If you passed an existing redis client to the constructor, it will be left open and you'll have to close it yourself when you're finished with it.

This returns a promise that resolves when the client connection is confirmed closed.

If you just want to stop polling, but leave the connection open, call `dt.stop()` instead.

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

## Testing

The test suite requires a local redis server on port 6379. You can run `docker-compose up` to launch one from this repo. Once redis is running, run `npm test` or `npm coverage`.

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

* Use non-legacy mode of node-redis v4.

* Trap errors from `callback()`

* Ability to cancel a task by ID or data. Will wait until there's a genuine desire for this. For now, we'll assume that a task won't be added until it _should_ run in the future.

* Add a flag when the class is polling to prevent conflicts on explicit polls.

* Better handling of watch conflicts in `dt.poll`. Right now it just quits, but if this happens a lot, nothing would end up getting processed.

* Find a redis mock that works with `node-redis` v4 and later versions of redis server.

## License
MIT License
