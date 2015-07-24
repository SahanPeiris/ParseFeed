/**
 * Created by fanxia on 7/22/15.
 */
var express = require('express');
var request = require('request');
var RateLimiter = require('limiter').RateLimiter;
var Q = require('q');
var _ = require('underscore');

var requestAsync = Q.nbind(request, request);
var router = express.Router();
var apiKeys = [
    'g7gl9ouuxlq1j35aqas99ai4',
    'jk9zf5f6why67bgjw34gmaux',
    '9fvuooi2ro6lugj1f554tw68',
    'qnuq6as3m1s8q6oj7edmxo1r',
    'urenkwm5ue2z2ay6iclyrg14',
    'zrip6abqkpsa0her1tu1fmb3',
    'gsen9fw0qhtszjri4psu3lsm',
    'u2r4qg68us1sm9hwwdg9jkv3',
    'ohwd0mbhhi868ctk8ju7lr4k',
    'uy1yqf4h0ghytnuj9fu1b2ml',
    'bvb5ldczlmo12mxk76isjsk3',
    '1mljb5pa3oh8mukwhv75s6qp',
    '3zzq14l7du4gxzi3haqcp01e',
    'cavou6i8fzuuysysukf27j9u',
    'du9tqq19t672d5z0ah2wu6ej',
    '549rcb265456oy1ej58cu5j1',
    '74drz6jzp5w1znz7x1p0xg81',
    'dairdcsk5mv481tw7f1qvnrk',
    '20410s24pp48inhfffcw065v',
    'zz3byrm5vpor6entir4pfcl2'
];
var limiters = createLimiters(apiKeys.length);

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

    var workerNum = calculateWorkerNum(apiKeys.length, feedNum);
    getEtsyFeedUsingMultipleWorkers(workerNum, feedNum,
        offset)
        .then(function (val) {
            res.header('Content-Type', 'application/json');
            res.send({count: val.length, results: val});
        })
        .catch(function (err) {
            var rejectedMsg = 'You have exceeded your quota of: 10 requests' +
                ' per 1 second(s) for public requests.';
            if (rejectedMsg === err.message) {
                res.send("Request has been rejected, please try again.");
            }
            else {
                res.send(err.message);
            }
        })
        .done();
});

function calculateWorkerNum(apiKeyNum, feedNum) {
    if (feedNum <= apiKeyNum) {
        return feedNum;
    }
    else if (feedNum <= (100 * apiKeyNum)) {
        return apiKeyNum;
    }
    else {
        return Math.ceil(feedNum / 100);
    }
}

function getEtsyFeedUsingMultipleWorkers(workerNum, feedNum, offset) {
    var feedPromises = [];

    var feedNumPerWorker = Math.ceil(feedNum / workerNum);
    var feedNumLastWorker = feedNum - (workerNum - 1) * feedNumPerWorker;
    for (var i = 0; i < workerNum - 1; i++) {
        var feedPromise = getEtsyFeedAsync(feedNumPerWorker, offset);
        offset += feedNumPerWorker;
        feedPromises.push(feedPromise);
    }
    // For the last worker
    if (feedNumLastWorker !== 0) {
        var lastFeedPromise = getEtsyFeedAsync(feedNumLastWorker, offset);
        feedPromises.push(lastFeedPromise);
    }

    return Q.all(feedPromises).then(function (res) {
        var shallowFaltten = true;
        return _.flatten(res, shallowFaltten);
    });
}

function getEtsyFeedAsync(feedNum, offset) {
    var apiKeyAndLimiterPromise = getLimiterAndApiKeyPair();
    var listingsPromise = apiKeyAndLimiterPromise.then(function (apiKeyAndLimiter) {
        return getEtsyListingsAsync(apiKeyAndLimiter.limiter,
            apiKeyAndLimiter.apiKey, feedNum,
            offset);
    });
    return listingsPromise.then(function (res) {
        var itemPromises = [];
        res.forEach(function (listing) {
            itemPromises.push(apiKeyAndLimiterPromise.then(function (apiKeyAndLimiter) {
                return getItemAsync(apiKeyAndLimiter.limiter, listing,
                    apiKeyAndLimiter.apiKey)
            }));
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
            def.resolve(requestAsync(config).then(function (res) {
                console.log(res[0].req.method, res[0].req.path,
                    res[0].statusCode);
                if (res[0].statusCode == 200) {
                    return res[1];
                }
                else {
                    throw new Error(res[1]);
                }
            }));
        }
    });

    return def.promise;
}

function createLimiters(num) {
    var limiters = [];
    for (var i = 0; i < num; i++) {
        limiters.push(new RateLimiter(1, 200));
    }
    return limiters;
}

function getLimiterAndApiKeyPair() {
    var def = Q.defer();
    if (apiKeys.length > 0 && limiters.length > 0) {
        var apiKey = apiKeys.shift();
        var limiter = limiters.shift();
        def.resolve({limiter: limiter, apiKey: apiKey});
        apiKeys.push(apiKey);
        limiters.push(limiter);
    }
    else {
        def.reject(new Error('No api key and limiter pair available.'));
    }
    return def.promise;
}

module.exports = router;