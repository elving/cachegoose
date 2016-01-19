let generateKey = require('./generate-key');

module.exports = function(mongoose, cache, debug) {
  let exec = mongoose.Query.prototype.exec;

  mongoose.Query.prototype.exec = function(op, callback = function() { }) {
    if (!this.hasOwnProperty('_ttl')) return exec.apply(this, arguments);

    if (typeof op === 'function') {
      callback = op;
      op = null;
    } else if (typeof op === 'string') {
      this.op = op;
    }

    let key     = this._key || this.getCacheKey()
      , ttl     = this._ttl
      , isLean  = this._mongooseOptions.lean
      , model   = this.model.modelName
      , promise = new mongoose.Promise()
      , populate = this._mongooseOptions.populate
      ;

    promise.onResolve(callback);

    cache.get(key, (err, cachedResults) => {
      if (cachedResults) {
        if (!isLean) {
          let constructor = mongoose.model(model);

          if (Array.isArray(cachedResults)) {
            Promise.all(cachedResults.map(inflateModel(constructor, populate))).then((models) => {
              cachedResults = models;
              if (debug) cachedResults._fromCache = true;
              promise.resolve(null, cachedResults);
            });
          } else {
            inflateModel(constructor, populate)(cachedResults).then((model) => {
              cachedResults = model;
              if (debug) cachedResults._fromCache = true;
              promise.resolve(null, cachedResults);
            });
          }
        } else {
          if (debug) cachedResults._fromCache = true;
          promise.resolve(null, cachedResults);
        }
      } else {
        exec.call(this).onResolve((err, results) => {
          if (err) return promise.resolve(err);
          cache.set(key, results, ttl, () => {
            promise.resolve(null, results);
          });
        });
      }
    });

    return promise;
  };

  mongoose.Query.prototype.cache = function(ttl = 60, customKey = '') {
    if (typeof ttl === 'string') {
      customKey = ttl;
      ttl = 60;
    }

    this._ttl = ttl;
    this._key = customKey;
    return this;
  };

  mongoose.Query.prototype.getCacheKey = function() {
    let key = {
      model: this.model.modelName,
      op: this.op,
      skip: this.options.skip,
      limit: this.options.limit,
      _options: this._mongooseOptions,
      _conditions: this._conditions,
      _fields: this._fields,
      _path: this._path,
      _distinct: this._distinct
    };

    return generateKey(key);
  };
};

function inflateModel(constructor, populate) {
  const fieldsToPopulate = populate ? Object.keys(populate) : [];

  return (data) => {
    return new Promise((resolve, reject) => {
      if (constructor.inflate) {
        return resolve(constructor.inflate(data));
      } else {
        let model = constructor(data);

        model.$__reset();
        model.isNew = false;

        if (fieldsToPopulate.length) {
          for (let field of fieldsToPopulate) {
            if (data[field]) {
              model.set(field, data[field].map((_populated) => _populated._id));
              model.populate(field);
            }
          }

          return model.execPopulate().then(resolve);
        } else {
          return resolve(model);
        }
      }
    });
  };
}
