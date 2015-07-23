/**
 * Created by fanxia on 7/22/15.
 */
var express = require('express');
var rp = require('request-promise');
var RateLimiter = require('limiter').RateLimiter;
var Q = require('q');
var _ = require('underscore');
var router = express.Router();

/**
 * Support n api_key and offset
 */
router.get('/', function (req, res, next) {
    var defaultFeedNum = 10;
    res.redirect(req.baseUrl + '/' + defaultFeedNum);
});

router.get('/:feedNum', function (req, res, next) {
    var feedNum = req.params.feedNum;
    var offset = req.query.offset || 0;
    console.log(feedNum, offset);

    var apiKeys = ['g7gl9ouuxlq1j35aqas99ai4'];
    var workerNum = calculateWorkerNum(apiKeys.length, feedNum);
    getEtsyFeedUsingMultipleWorkers(apiKeys, workerNum, feedNum, offset)
        .then(function (val) {
            res.header('Content-Type', 'application/json');
            res.send({count: val.length, results: val});
        })
        .done();
});

function calculateWorkerNum(apiKeyNum, feedNum) {
    if (feedNum <= 100) {
        return apiKeyNum;
    }
    else {
        return Math.ceil(feedNum / 100);
    }
}

function getEtsyFeedUsingMultipleWorkers(apiKeys, workerNum, feedNum, offset) {
    var feedPromises = [];

    var apiKeyPromise = getApiKeyAsync(apiKeys);
    var feedNumPerWorker = Math.ceil(feedNum / workerNum);
    var feedNumLastWorker = feedNum - (workerNum - 1) * feedNumPerWorker;
    for (var i = 0; i < workerNum - 1; i++) {
        var feedPromise = apiKeyPromise.then(function (apiKey) {
            return getEtsyFeedAsync(apiKey, feedNumPerWorker, offset)
                .then(function (res) {
                    apiKeys.push(apiKey);
                    return res;
                });
        });
        offset += feedNumPerWorker;
        feedPromises.push(feedPromise);
    }
    // For the last worker
    var lastFeedPromise = apiKeyPromise.then(function (apiKey) {
        return getEtsyFeedAsync(apiKey, feedNumLastWorker, offset)
            .then(function (res) {
                apiKeys.push(apiKey);
                return res;
            });
    });
    feedPromises.push(lastFeedPromise);
    return Q.all(feedPromises).then(function (res) {
        var shallowFaltten = true;
        return _.flatten(res, shallowFaltten);
    });
}

function getEtsyFeedAsync(apiKey, feedNum, offset) {
    var limiter = new RateLimiter(1, 150);
    var listingsPromise = getEtsyListingsAsync(limiter, apiKey, feedNum,
        offset);
    return listingsPromise.then(function (res) {
        var itemPromises = [];
        res.forEach(function (listing) {
            itemPromises.push(getItemAsync(limiter, listing, apiKey));
        });
        return Q.all(itemPromises);
    })
}

function getItemAsync(limiter, listing, apiKey) {
    var config = {
        url: 'https://openapi.etsy.com/v2/listings/' +
        listing.listing_id + '/images',
        qs: {
            api_key: apiKey
        },
        method: 'GET'
    };
    var imagePromise = sendRequestAsync(config, limiter);
    return imagePromise.then(function (res) {
        var jsonBody = JSON.parse(res);
        var imageNum = jsonBody.count;
        if (imageNum > 0) {
            var imageResult = jsonBody.results[0];

            var images = [imageResult.url_75x75,
                imageResult.url_170x135,
                imageResult.url_570xN,
                imageResult.url_fullxfull];

            return {
                id: listing.listing_id,
                title: listing.title,
                images: images,
                description: listing.description,
                price: listing.price,
                currency_code: listing.currency_code
            };
        }
        else {
            throw new Error('No images available');
        }
    });
}

function getEtsyListingsAsync(limiter, apiKey, feedNum, offset) {
    var config = {
        url: 'https://openapi.etsy.com/v2/listings/active',
        qs: {
            api_key: apiKey,
            limit: feedNum,
            offset: offset
        },
        method: 'GET'
    };
    return sendRequestAsync(config, limiter)
        .then(function (res) {
            var jsonBody = JSON.parse(res);
            var listingsNum = jsonBody.count;
            if (listingsNum > 0) {
                return _.map(jsonBody.results, function (listing) {
                    return {
                        listing_id: listing.listing_id,
                        title: listing.title,
                        description: listing.description,
                        price: listing.price,
                        currency_code: listing.currency_code
                    };
                });
            }
            else {
                throw new Error('No listings available');
            }
        });
}

function sendRequestAsync(config, limiter) {
    var def = Q.defer();
    limiter.removeTokens(1, function (err) {
        if (err) {
            def.reject(err)
        }
        else {
            def.resolve(rp(config));
        }
    });

    return def.promise;
}

function getApiKeyAsync(apiKeys) {
    var gotKey = Q.defer();

    function loop() {
        if (apiKeys.length > 0) {
            return gotKey.resolve(apiKeys.shift());
        }

        Q.when(null, loop, gotKey.reject)
    }

    Q.nextTick(loop);

    return gotKey.promise;
}

module.exports = router;