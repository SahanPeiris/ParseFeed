/**
 * Created by fanxia on 7/20/15.
 */
var express = require('express');
var request = require('request');
var Q = require('q');
var router = express.Router();

/* GET feed */
router.get('/:feedNum', function (req, res, next) {
    var feedNum = req.params.feedNum;
    console.log(feedNum);

    Q.when(null)
        .then(function () {
            var deferred = Q.defer();

            var rst = [];
            for (var sec = 0; sec < Math.ceil(feedNum / 9); sec++)
            {
                var timeDelay = 2000 * sec;
                var offset = sec * 9;
                setTimeout(loadEtsyFeed, timeDelay, offset, res, function (err, listings) {
                    if (err)
                    {
                        console.log(err.message);
                    }
                    else {
                        rst = rst.concat(listings);
                        if (rst.length >= feedNum) {
                            deferred.resolve(rst);
                        }
                    }
                });
            }

            return deferred.promise;
        })
        .then(function (listings) {
            res.end(JSON.stringify({count: listings.length, results: listings}));
        })
        .catch(function (err) {
            console.log(err.message);
        })
        .done();

});

function loadEtsyFeed (offset, res, cb){
    var listings = [];
    Q.when(null)
        .then(function () {
            var deferred = Q.defer();

            var reqConfig = {
                url: 'https://openapi.etsy.com/v2/listings/active',
                qs: {
                    api_key: '9fvuooi2ro6lugj1f554tw68',
                    limit: 9,
                    offset: offset
                },
                method: 'GET'
            };
            request(reqConfig, function (err, resp, body) {
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
                        deferred.reject('No listings available');
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
                                api_key: '9fvuooi2ro6lugj1f554tw68'
                            },
                            method: 'GET'
                        };

                        var deferred = Q.defer();
                        request(reqConfig, function (err, resp, body) {
                            if (err) {
                                console.log(err);
                            }
                            else {
                                var jsonBody = JSON.parse(body);
                                var imageCount = jsonBody.count;
                                if (imageCount > 0) {
                                    var imageResult = {};
                                    if (imageCount > 1) {
                                        imageResult = jsonBody.results[0];
                                    }
                                    else {
                                        imageResult = jsonBody.results;
                                    }

                                    var images = [imageResult.url_75x75,
                                        imageResult.url_170x135,
                                        imageResult.url_570xN,
                                        imageResult.fullxfull];
                                    deferred.resolve({
                                        title: listing.title,
                                        images: images,
                                        description: listing.description,
                                        price: listing.price,
                                        currency_code: listing.currency_code
                                    });
                                }
                                else {
                                    deferred.reject('No images available');
                                }
                            }
                        });
                        return deferred.promise;
                    })
                    .then(function (listing) {
                        console.log(listing);
                        listings.push(listing);
                    })
                    .then(function () {
                        if (listings.length == results.length) {
                            deferred.resolve(listings);
                        }
                    })
                    .catch(function (err) {
                        cb(err);
                    })
                    .done();
            }
            return deferred.promise;
        })
        .then(function (listings) {
            cb(null, listings);
        })
        .catch(function (err) {
            cb(err);
        })
        .done();
}

module.exports = router;