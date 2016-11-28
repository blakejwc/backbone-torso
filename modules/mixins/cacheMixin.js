(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['underscore', 'jquery'], factory);
  } else if (typeof exports === 'object') {
    module.exports = factory(require('underscore'), require('jquery'));
  } else {
    root.Torso = root.Torso || {};
    root.Torso.Mixins = root.Torso.Mixins || {};
    root.Torso.Mixins.cache = factory(root._, (root.jQuery || root.Zepto || root.ender || root.$));
  }
}(this, function(_, $) {

  var fetchIdentifier = 0;
  /**
   * Custom additions to the Backbone Collection object.
   * - safe disposal methods for memory + event management
   * - special functional overrides to support ID registration for different views
   *
   * @module    Torso
   * @namespace Torso.Mixins
   * @class  cacheMixin
   * @author ariel.wexler@vecna.com, kent.willis@vecna.com
   */
  var mixin = function(base) {

    var cacheMixin, createRequesterCollectionClass;

    /**
     * Returns a new class of collection that inherits from the parent but not the cacheMixin
     * and adds a requesterMixin that connects this cache to it's parent
     *
     * @method createRequesterCollectionClass
     * @param parent {Backbone Collection instance} the parent of the private collection
     * @param guid {String} the unique code of the owner of this private collection
     */
    createRequesterCollectionClass = function(parent, guid) {
      return parent.constructor.extend((function(parentClass, parentInstance, ownerKey) {

        /**
         * A mixin that overrides base collection methods meant for cache's and tailors them
         * to a requester.
         * @method requesterMixin
         */
        var requesterMixin = {

          /**
           * @method requesterMixin.getTrackedIds
           * @return {Array} array of ids that this collection is tracking
           */
          getTrackedIds: function() {
            return this.trackedIds;
          },

          /**
           * Will force the cache to fetch just the registered ids of this collection
           * @method requesterMixin.fetch
           * @param [options] - argument options
           * @param [options.idsToFetch=collectionTrackedIds] {Array} - A list of request Ids, will default to current tracked ids
           * @param [options.setOptions] {Object} - if a set is made, then the setOptions will be passed into the set method
           * @return {Promise} promise that will resolve when the fetch is complete
           */
          fetch: function(options) {
            options = options || {};
            options.idsToFetch = options.idsToFetch || this.trackedIds;
            options.setOptions = options.setOptions || {remove: false};
            return this.__loadWrapper(function() {
              if (options.idsToFetch && options.idsToFetch.length) {
                return parentInstance.fetchByIds(options);
              } else {
                return $.Deferred().resolve().promise();
              }
            });
          },

          /**
           * Will force the cache to fetch a subset of this collection's tracked ids
           * @method requesterMixin.fetchByIds
           * @param ids {Array} array of model ids
           * @param [options] {Object} if given, will pass the options argument to this.fetch. Note, will not affect options.idsToFetch
           * @return {Promise} promise that will resolve when the fetch is complete
           */
          fetchByIds: function(ids, options) {
            options = options || {};
            options.idsToFetch = _.intersection(ids, this.getTrackedIds());
            return this.fetch(options);
          },

          /**
           * Pass a list of ids to begin tracking. This will reset any previous list of ids being tracked.
           * Overrides the Id registration system to route via the parent collection
           * @method requesterMixin.trackIds
           * @param ids The list of ids that this collection wants to track
           */
          trackIds: function(ids) {
            this.remove(_.difference(this.trackedIds, ids));
            parentInstance.registerIds(ids, ownerKey);
            this.trackedIds = ids;
          },

          /**
           * Adds a new model to the requester collection and tracks the model.id
           * @method requesterMixin.addModelAndTrack
           * @param model {Backbone Model} the model to be added
           */
          addModelAndTrack: function(model) {
            this.add(model);
            parentInstance.add(model);
            this.trackNewId(model.id);
          },

          /**
           * Tracks a new id
           * @method requesterMixin.trackNewId
           * @param id {String or Number} the id attribute of the model
           */
          trackNewId: function(id) {
            this.trackIds(this.getTrackedIds().concat(id));
          },

          /**
           * Will begin tracking the new ids and then ask the cache to fetch them
           * This will reset any previous list of ids being tracked.
           * @method requesterMixin.trackAndFetch
           * @return the promise of the fetch by ids
           */
          trackAndFetch: function(newIds) {
            this.trackIds(newIds);
            return this.fetch();
          },

          /**
           * Will force the cache to fetch any of this collection's tracked models that are not in the cache
           * while not fetching models that are already in the cache. Useful when you want the effeciency of
           * pulling models from the cache and don't need all the models to be up-to-date.
           *
           * If the ids being fetched are already being fetched by the cache, then they will not be re-fetched.
           *
           * The resulting promise is resolved when ALL items in the process of being fetched have completed.
           * The promise will resolve to a unified data property that is a combination of the completion of all of the fetches.
           *
           * @method requesterMixin.pull
           * @param [options] {Object} if given, will pass the options argument to this.fetch. Note, will not affect options.idsToFetch
           * @return {Promise} promise that will resolve when the fetch is complete with all of the data that was fetched from the server.
           *                   Will only resolve once all ids have attempted to be fetched from the server.
           */
          pull: function(options) {
            options = options || {};

            //find ids that we don't have in cache and aren't already in the process of being fetched.
            var idsNotInCache = _.difference(this.getTrackedIds(), _.pluck(parentInstance.models, 'id'));
            var allExistingPromisesForIds = _.pick(parentInstance.idPromises, idsNotInCache);
            var idsWithPromises = _.mapObject(allExistingPromisesForIds, _.isEmpty);

            // Determine which ids are already being fetched and the associated promises for those ids.
            options.idsToFetch = _.difference(idsNotInCache, _.uniq(_.flatten(_.keys(idsWithPromises))));
            var thisFetchPromise = this.fetch(options);

            // Return a promise that resolves when all ids are fetched (including pending ids).
            var allPromisesToWaitFor = _.flatten(_.values(idsWithPromises));
            allPromisesToWaitFor.push(thisFetchPromise);
            var allUniquePromisesToWaitFor = _.uniq(allPromisesToWaitFor);
            return $.when.apply($, allUniquePromisesToWaitFor)
              // Make it look like the muliple promises was performed by a single request.
              .then(function() {
                // collects the parts of each ajax call into arrays: result = { [data1, data2, ...], [textStatus1, textStatus2, ...], [jqXHR1, jqXHR2, ...] };
                var result = _.zip(arguments);
                // Flatten the data so it looks like the result of a single request.
                var resultData = result[0];
                var flattenedResultData = _.flatten(resultData);
                return flattenedResultData;
              });
          },

          /**
           * Will register the new ids and then pull in any models not stored in the cache. See this.pull() for
           * the difference between pull and fetch.
           * @method requesterMixin.trackAndPull
           * @return the promise of the fetch by ids
           */
          trackAndPull: function(newIds) {
            this.trackIds(newIds);
            return this.pull();
          },

          /**
           * Handles the disposing of this collection as it relates to a requester collection.
           * @method requesterMixin.requesterDispose
           */
          requesterDispose: function() {
            parentInstance.removeRequester(ownerKey);
          }
        };

        return requesterMixin;
      })(parent.constructor.__super__, parent, guid));
    };

    /**
     * Adds functions to manage state of requesters
     * @method cacheMixin
     * @param collection {Collection} the collection to add this mixin
     */
    cacheMixin = function(collection) {

      //************* PRIVATE METHODS ************//

      /**
       * @private
       * @method cacheMixin.setRequestedIds
       * @param guid {String} the global unique identifier for the requester
       * @param array {Array} the array of ids the requester wants
       */
      var setRequestedIds = function(guid, array) {
        collection.requestMap[guid] = {
          array: array,
          dict: _.object(_.map(array, function(id) { return [id, id]; }))
        };
      };

      //*********** PUBLIC METHODS ************//

      /**
       * @method cacheMixin.getRequesterIds
       * @param {String} the global unique id of the requester
       * @return {Array} an array of the ids the requester with the guid has requested
       */
      collection.getRequesterIds = function(guid) {
        return this.requestMap[guid] && this.requestMap[guid].array;
      };

      /**
       * @method cacheMixin.getRequesterIdsAsDictionary
       * This method is used for quick look up of a certain id within the list of requested ids
       * @param guid {String} the global unique id of the requester
       * @return {Object} an dictionary of id -> id of the requester ids for a given requester.
       */
      collection.getRequesterIdsAsDictionary = function(guid) {
        return this.requestMap[guid] && this.requestMap[guid].dict;
      };

      /**
       * @method cacheMixin.removeRequester
       * Removes a requester from this cache. No longer receives updates
       * @param guid {String} the global unique id of the requester
       */
      collection.removeRequester = function(guid) {
        delete this.requestMap[guid];
        delete this.knownPrivateCollections[guid];
      };

      /**
       * NOTE: this methods returns only the guids for requester collections that are currently tracking ids
       * TODO: should this return just the knownPrivateCollections
       * @method cacheMixin.getRequesters
       * @return {Array} an array of the all requesters in the form of their GUID's
       */
      collection.getRequesters = function()  {
        return _.keys(this.requestMap);
      };

      /**
       * Return the list of Ids requested by this collection
       * @method cacheMixin.getAllRequestedIds
       * @return {Array} the corresponding requested Ids
       */
      collection.getAllRequestedIds = function() {
        return this.collectionTrackedIds;
      };

      /**
       * Used to return a collection of desired models given the requester object.
       * Binds a custom "resized" event to the private collections.
       * Overrides the fetch method to call the parent collection's fetchByIds method.
       * Overrides the registerIds method to redirect to its parent collection.
       * @method cacheMixin.createPrivateCollection
       * @param guid {String} Identifier for the requesting view
       * @return {Collection} an new empty collection of the same type as "this"
       */
      collection.createPrivateCollection = function(guid, args) {
        args = args || {};
        args.isRequester = true;
        args.parentInstance = collection;
        var RequesterClass = createRequesterCollectionClass(collection, guid);
        this.knownPrivateCollections[guid] = new RequesterClass(null, args);
        return this.knownPrivateCollections[guid];
      };

      /**
       * Registers a list of Ids that a particular object cares about and pushes
       * any cached models its way.
       *
       * This method intelligently updates the "_requestedIds" field to contain all unique
       * requests for Ids to be fetched.  Furthermore, the "polledFetch" method
       * is overriden such that it no longer routes through Backbone's fetch all,
       * but rather a custom "fetchByIds" method.
       * @method cacheMixin.registerIds
       * @param newIds {Array}  - New ids to register under the requester
       * @param guid {String}   - The GUID of the object that wants the ids
       */
      collection.registerIds = function(newIds, guid) {
        var i, newIdx, model, requesterIdx, storedIds,
            requesters, requesterLength, privateCollection,
            models = [],
            distinctIds = {},
            result = [];

        // Save the new requests in the map
        setRequestedIds(guid, newIds);
        requesters = collection.getRequesters();
        requesterLength = requesters.length;

        // Collect all cached models
        for (newIdx = 0; newIdx < newIds.length; newIdx++) {
          model = collection.get(newIds[newIdx]);
          if (model) {
            models.push(model);
          }
        }

        // Push cached models to the respective requester
        privateCollection = collection.knownPrivateCollections[guid];
        privateCollection.set(models, {remove: false});

        // Create a new request list
        for (requesterIdx = 0; requesterIdx < requesterLength; requesterIdx++) {
          storedIds = this.getRequesterIds(requesters[requesterIdx]);
          if (!_.isUndefined(storedIds)) {
            for (i = 0; i < storedIds.length; i++) {
              distinctIds[storedIds[i]] = true;
            }
          }
        }

        // Convert the hash table of unique Ids to a list
        for (i in distinctIds) {
          result.push(i);
        }
        this.collectionTrackedIds = result;

        // Overrides the polling mixin's fetch method
        this.polledFetch = function() {
          collection.fetchByIds({
            setOptions: {remove: true}
          });
        };
      };

      /**
       * Overrides the base fetch call if this.fetchUsingTrackedIds is true
       * Calling fetch from the cache will fetch the tracked ids if fetchUsingTrackedIds is set to true, otherwise
       * it will pass through to the default fetch.
       * @method fetch
       */
      collection.fetch = function(options) {
        options = options || {};
        if (this.fetchUsingTrackedIds) {
          return this.fetchByIds({
            setOptions: _.extend({remove: true}, options)
          });
        } else {
          return base.prototype.fetch.apply(this, options);
        }
      };

      /**
       * A custom fetch operation to only fetch the requested Ids.
       * @method cacheMixin.fetchByIds
       * @param [options] - argument options
       * @param [options.idsToFetch=collection.collectionTrackedIds] {Array} - A list of request Ids, will default to current tracked ids
       * @param [options.setOptions] {Object} - if a set is made, then the setOptions will be passed into the set method
       * @return {Promise} the promise of the fetch
       */
      collection.fetchByIds = function(options) {
        var fetchId = fetchIdentifier++;
        options = options || {};
        // Fires a method from the loadingMixin that wraps the fetch with events that happen before and after
        var requestedIds = options.idsToFetch || collection.collectionTrackedIds;
        var fetchComplete = false;
        var fetchPromise = this.__loadWrapper(function(options) {
          var contentType = options.fetchContentType || collection.fetchContentType;
          var ajaxOpts = {
              type: collection.fetchHttpAction,
              url: _.result(collection, 'url') + collection.getByIdsUrl,
              data: {ids: requestedIds.join(',')}
            };
          if (contentType || (ajaxOpts.type && ajaxOpts.type.toUpperCase() != 'GET')) {
            ajaxOpts.contentType = contentType || 'application/json; charset=utf-8';
            ajaxOpts.data = JSON.stringify(requestedIds);
          }
          return $.ajax(ajaxOpts)
            .done(function(data) {
              var i, requesterIdx, requesterIdsAsDict, models, privateCollection,
                  requesterLength, requesters, model,
                  requestedIdsLength = requestedIds.length,
                  setOptions = options.setOptions;
              collection.set(collection.parse(data), setOptions);
              // Set respective collection's models for requested ids only.
              requesters = collection.getRequesters();
              requesterLength = requesters.length;
              // For each requester...
              for (requesterIdx = 0; requesterIdx < requesterLength; requesterIdx++) {
                requesterIdsAsDict = collection.getRequesterIdsAsDictionary(requesters[requesterIdx]);
                models = [];
                // ... now let's iterate over the ids that were fetched ...
                for (i = 0; i < requestedIdsLength; i++) {
                  //if the id that the requester cares about matches that model whose id was just fetched...
                  if (requesterIdsAsDict[requestedIds[i]]) {
                    model = collection.get(requestedIds[i]);
                    // if the model was removed, no worries, the parent won't attempt to update the child on that one.
                    if (model) {
                      models.push(model);
                    }
                  }
                }
                privateCollection = collection.knownPrivateCollections[requesters[requesterIdx]];
                // a fetch by the parent will not remove a model in a requester collection that wasn't fetched with this call
                privateCollection.set(models, {remove: false});
              }
            });
        }, options)
          .always(function() {
            // This happens once the promise is resolved, and removes the pending promise for that id.

            // Track that the fetch was completed so we don't add a dead promise (since this is what cleans up completed promises).
            fetchComplete = true;

            // Note that an id may have mulitple promises (if fetch was called multiple times and then a pull with the same id). 
            // We want to wait for all of them to complete, this tracks them separately and removes the in-flight promises once they are done.
            _.each(requestedIds, function(requestedId) {
              if (collection.idPromises) {
                var existingPromisesForId = collection.idPromises[requestedId];
                collection.idPromises[requestedId] = _.without(existingPromisesForId, fetchPromise);
              }
            });
          });

        // Track the promises associated with each id so we know when that id has completed fetching.
        // Multiple simultaneous pulls will generate multiple promises for a shared id.  
        // Pulls will not generate new promises for the given ids (if there are ids being fetched
        if (!fetchComplete) { // fixes the sync case (mainly during tests when mockjax is used).
          _.each(requestedIds, function(requestedId) {
            var existingPromises = collection.idPromises[requestedId];
            if (!existingPromises) {
              existingPromises = [];
              collection.idPromises[requestedId] = existingPromises;
            }

            existingPromises.push(fetchPromise);
          });
        }

        return fetchPromise;
      };
    };

    return {
      /**
       * The constructor constructor / initialize method for collections.
       * Allocate new memory for the local references if they
       * were null when this method was called.
       * @param [options] {Object} - optional options object
       * @param   [options.fetchHttpAction='POST'] {String} http action used to get objects by ids
       * @param   [options.getByIdsUrl='/ids'] {String} path appended to collection.url to get objects by a list of ids
       * @param   [options.fetchUsingTrackedIds=true] {Boolean} if set to false, cache.fetch() will not pass to fetchByIds with current tracked ids
                                                               but will rather call the default fetch method.
       * @method constructor
       */
      constructor: function(models, options) {
        options = options || {};
        base.call(this, models, options);
        this.isRequester = options.isRequester;
        this.parentInstance = options.parentInstance;
        if (!this.isRequester) {
          this.requestMap = {};
          this.collectionTrackedIds = [];
          this.knownPrivateCollections = {};
          this.idPromises = {};
          var cacheDefaults = _.defaults(
            _.pick(options, 'getByIdsUrl', 'fetchHttpAction', 'fetchUsingTrackedIds'),
            _.pick(this, 'getByIdsUrl', 'fetchHttpAction', 'fetchUsingTrackedIds'),
            {
              getByIdsUrl: '/ids',
              fetchHttpAction: 'GET',
              fetchUsingTrackedIds: true
            }
          );
          _.extend(this, cacheDefaults);
          cacheMixin(this);
        } else {
          this.trackedIds = [];
          this.listenTo(this.parentInstance, 'load-begin', function() {
            this.trigger('cache-load-begin');
          });
          this.listenTo(this.parentInstance, 'load-complete', function() {
            this.trigger('cache-load-complete');
          });
        }
      },
    };
  };

  return mixin;
}));
