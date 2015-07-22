/**
 * Created by fanxia on 7/20/15.
 */
var express = require('express');
var request = require('request');
var RateLimiter = require('limiter').RateLimiter;
var Q = require('q');
var router = express.Router();

/* GET feed */
router.get('/:feedNum', function (req, res, next) {
    var feedNum = req.params.feedNum;
    var offset = 0;
    console.log(feedNum);
    var apiKey = '9fvuooi2ro6lugj1f554tw68';
    loadEtsyFeed(apiKey, feedNum, offset, function (err, data) {
        if (err) {
            console.log(err.message);
        }
        else {
            res.send({count: data.length, results: data})
        }
    });

});

function loadEtsyFeed(apiKey, limit, offset, cb) {
    var limiter = new RateLimiter(1, 150);
    var listings = [];
    Q.when(null)
        .then(function () {
            var deferred = Q.defer();

            var reqConfig = {
                url: 'https://openapi.etsy.com/v2/listings/active',
                qs: {
                    api_key: apiKey,
                    limit: limit,
                    offset: offset
                },
                method: 'GET'
            };
            rateLimitRequest(reqConfig, limiter, function (err, resp, body) {
                if (err) {
                    console.log(err);
                }
                else {
                    var jsonBody = JSON.parse(body);
                    var totalListingCount = jsonBody.count;
                    if (totalListingCount > 0) {

                        deferred.resolve(jsonBody.results);
                    }
                    else {
                        deferred.reject(new Error('No listings available'));
                    }
                }
            });
            return deferred.promise;
        })
        .then(function (results) {

            var deferred = Q.defer();
            for (var i = 0; i < results.length; i++) {
                Q.when(results[i])
                    .then(function (listing) {
                        return {
                            listing_id: listing.listing_id,
                            title: listing.title,
                            description: listing.description,
                            price: listing.price,
                            currency_code: listing.currency_code
                        };
                    })
                    .then(function (listing) {
                        var reqConfig = {
                            url: 'https://openapi.etsy.com/v2/listings/' +
                            listing.listing_id + '/images',
                            qs: {
                                api_key: apiKey
                            },
                            method: 'GET'
                        };

                        var deferred = Q.defer();
                        rateLimitRequest(reqConfig, limiter,
                            function (err, resp, body) {
                                if (err) {
                                    console.log(err);
                                }
                                else if (body.indexOf('You have') === 0) {
                                    deferred.reject(new Error(body));
                                }
                                else {
                                    var jsonBody = JSON.parse(body);
                                    var imageCount = jsonBody.count;
                                    if (imageCount > 0) {
                                        var imageResult = jsonBody.results[0];;

                                        var images = [imageResult.url_75x75,
                                            imageResult.url_170x135,
                                            imageResult.url_570xN,
                                            imageResult.url_fullxfull];
                                        deferred.resolve({
                                            id: listing.listing_id,
                                            title: listing.title,
                                            images: images,
                                            description: listing.description,
                                            price: listing.price,
                                            currency_code: listing.currency_code
                                        });
                                    }
                                    else {
                                        deferred.reject(new Error('No images' +
                                            ' available'));
                                    }
                                }
                            });
                        return deferred.promise;
                    })
                    .then(function (listing) {
                        listings.push(listing);
                    })
                    .then(function () {
                        if (listings.length == results.length) {
                            deferred.resolve(listings);
                        }
                    })
                    .catch(function (err) {
                        console.log(err.message);
                        deferred.reject(err);
                    })
                    .done();
            }
            return deferred.promise;
        })
        .then(function (listings) {
            cb(null, listings);
        })
        .catch(function (err) {
            console.log(err.message);
            cb(err);
        })
        .done();
}

function rateLimitRequest(config, limiter, cb) {
    limiter.removeTokens(1, function () {
        request(config, cb);
    });
}

/** Get from Stackoverflow post
 *  (http://stackoverflow.com/questions/17217736/while-loop-with-promises)
 */
function promiseWhile(condition, body) {
    var done = Q.defer();

    function loop() {
        // When the result of calling `condition` is no longer true, we are
        // done.
        if (!condition()) return done.resolve();
        // Use `when`, in case `body` does not return a promise.
        // When it completes loop again otherwise, if it fails, reject the
        // done promise
        Q.when(body(), loop, done.reject);
    }

    // Start running the loop in the next tick so that this function is
    // completely async. It would be unexpected if `body` was called
    // synchronously the first time.
    Q.nextTick(loop);

    // The promise
    return done.promise;
}

module.exports = router;