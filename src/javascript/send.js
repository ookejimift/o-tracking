/*global Track, window, XMLHttpRequest, ActiveXObject*/
/**
 * Queuing and sending tags
 * Keep track of individual requests in case any fail due to network errors / being offline / browser being closed mid-request.
 * @module _Core
 * @submodule Send
 * @class Track._Core.Send
 * @static
 */
Track._Core.Send = (function (parent, window, XMLHttpRequest, ActiveXObject) {
    "use strict";

    /**
     * Shared "internal" scope.
     * @property _self
     * @type {Object}
     * @private
     */
    var self = parent._self = parent._self || {},

        /**
         * iJento production server.
         * @property iJentoProdServer
         * @final
         * @private
         */
            iJentoProdServer = 'http://stats.ft.com',
        /**
         * iJento test server.
         * @property iJentoProdServer
         * @final
         * @private
         */
            iJentoTestServer = 'http://statstest.ft.com',
        /**
         * iJento image path.
         * @property trackerUrl
         * @final
         * @private
         */
            iJentoPath = "/si/track.gif",

        /**
         * Queue store.
         * @property store
         * @private
         */
            store = [],
        /**
         * Local Storage key.
         * @property storageKey
         * @final
         * @private
         */
            storageKey = "ft-tracking_requests",
        /**
         * Requests being sent right now.
         * @property currentRequests
         * @private
         */
            currentRequests = {};

    /**
     * Marks a request as current.
     * @method started
     * @param id {String} The ID of the request.
     * @private
     */
    function started(id) {
        currentRequests[id] = true;
    }

    /**
     * Marks a request as no longer current.
     * @method finished
     * @param id {String} The ID of the request.
     * @private
     */
    function finished(id) {
        delete currentRequests[id];
    }

    /**
     * Save the current store to localStorage so that old requests can still be sent after a page refresh.
     * @method save
     * @private
     */
    function save() {
        try {
            if (!window.localStorage) {
                return;
            }

            window.localStorage.setItem(storageKey, JSON.stringify(store));
        } catch (e) {
        }
    }

    /**
     * Gets the next pending request.
     * @method next
     * @return {Object}
     * @private
     */
    function next() {
        if (store.length === 0) {
            return null;
        }

        // If the next request is still current, then don't return it.
        // (It is possible that there are requests further in the queue which could be sent at this point, but it's probably best to wait in case we end up making a ridiculous number of concurrent requests).
        if (currentRequests[store[0].requestID]) {
            return null;
        }

        return store[0];
    }

    /**
     * Marks a request as no longer current and removes it from the queue.
     * @method success
     * @param id {String} The ID of the request.
     * @private
     */
    function success(id) {
        var i, l;
        finished(id);
        for (i = 0, l = store.length; i < l; i = i + 1) {
            if (id === store[i].requestID) {
                store.splice(i, 1);
                save();
                break;
            }
        }
    }

    /**
     * Generates an Adler 32 checksum of the input data.
     * @method generateChecksum
     * @param input {String} The input string.
     * @return {String} The checksum.
     * @private
     */
    function generateChecksum(input) {
        var a = 1,
            b = 0,
            i,
            chk;

        for (i = 0; i < input.length; i = i + 1) {
            a += input.charCodeAt(i);
            b += a;
        }

        // A and B must be modulo 65521 (the largest prime number smaller than 2^16)
        a %= 65521;
        b %= 65521;

        chk = (b * 65536) + a;
        return chk.toString(16);
    }

    /**
     * Encodes a given input string in base64.
     * @method encodeString
     * @param input {String} The string to encode.
     * @return {String} The base64-encoded value of the input string.
     * @private
     */
    function encodeString(input) {
        if (!input) {
            return '';
        }

        var output = [],
            i,
            numBytesLeft,
            value;

        for (i = 0; i < input.length; i += 3) {
            numBytesLeft = input.length - i;
            value = 0;
            value = (input.charCodeAt(i) << 16) & 0x00ff0000;
            value |= (numBytesLeft > 1) ? (input.charCodeAt(i + 1) << 8) & 0x0000ff00 : 0;
            value |= (numBytesLeft > 2) ? input.charCodeAt(i + 2) & 0x000000ff : 0;

            output.push(TRANS_CHARS.charAt((value & 0x00fC0000) >> 18));
            output.push(TRANS_CHARS.charAt((value & 0x0003f000) >> 12));
            output.push((numBytesLeft > 1) ? TRANS_CHARS.charAt((value & 0x00000fc0) >> 6) : '_');
            output.push((numBytesLeft > 2) ? TRANS_CHARS.charAt((value & 0x0000003f)) : '_');
        }

        return output.join('');
    }

    /**
     * Encode the values into an iJento string.
     * @method encodeDetails
     * @param format {String} The format (or ordering) of the values.
     * @param values {Object} The values to encode.
     * @return {String} The encoded string.
     * @private
     */
    function encodeDetails(format, values) {
        format = format.split('');

        var i,
            output = [];

        for (i = 0; i < format.length; i = i + 1) {
            output.push(encodeString(values[format[i]]));
        }

        return output.join('*')  + "*";
    }

    /**
     * Get the tracking pixel url for the chosen environment.
     * @method taggingServer
     * @param [environment] {String} The environment. Either <code>production</code> or <code>test</code>.
     * @return {String} Host and path of the iJento tracking pixel.
     * @private
     */
    function taggingServer(environment) {
        return (environment === 'production' ? iJentoProdServer : iJentoTestServer) + iJentoPath;
    }

    /**
     * Attempts to send a tracking request.
     * @method sendRequest
     * @param request {Object} The request to be sent.
     * @param next {Function} Callback to fire the next item in the queue.
     * @async
     */
    function sendRequest(request, next) {
        /* Example request:
         *  {
         *      environment: 'test',
         *      clickID: 't1388678300273',
         *      async: false,
         *      callback: [Function],
         *      format: 'pcrtgyuo',
         *      values: {
         *          c: '',
         *          t: 't1388678300273',
         *          u: '8.289.8675019387156.1388678301549.-fdc94dd',
         *          o: 1,
         *          p: 'http://www.ft.com/home/uk',
         *          r: '',
         *          g: 'co=24&sr=1920x1080<=2014-01-02T15%3A58%3A20.273Z&jv=',
         *          y: 'page'
         *      },
         *      requestID: '8.289.8675019387156.1388678301549.-fdc94dd',
         *      queueTime: 1234
         *  }
         */
        var offlineLag = (new Date()).getTime() - request.queueTime,
            query,
            checksum,
            xmlHttp;

        // Only bothered about offlineLag if it's longer than a second, but less than a month. (Especially as Date can be dodgy)
        if (offlineLag > 1000 && offlineLag < (31 * 24 * 60 * 60 * 1000)) {
            request.offlineLag = offlineLag; // TODO
        }
        delete request.queueTime;

        query = "f=" + request.format + "&d=" + encodeDetails(request.format, request.values);
        checksum = "&c=" + generateChecksum(query);

        try {
            // code for IE7+, Firefox, Chrome, Opera, Safari
            xmlHttp = new XMLHttpRequest();
        } catch (e) {
            // code for IE6, IE5
            try {
                xmlHttp = new ActiveXObject("Microsoft.XMLHttp");
            } catch (ee) {
                // TODO imagetag
            }
        }

        function requestFinished() {
            if (request.callback) {
                request.callback.call(request, xmlHttp);
            }
            if (xmlHttp.status >= 200 && xmlHttp.status < 300) {
                success(request.requestID);
                next();
            } else {
                finished(request.requestID);
            }
        }

        if (request.async) {
            xmlHttp.onreadystatechange = function () {
                if (xmlHttp.readyState === 4) {
                    requestFinished();
                }
            };
            xmlHttp.onerror = requestFinished;
        }

        started(request.requestID);

        xmlHttp.open("POST", taggingServer(request.environment), request.async);
        xmlHttp.send(['f=', request.format, '&', 'd=', query, '&', 'c=', checksum].join(''));

        if (!request.async) {
            requestFinished();
        }
    }


    /**
     * Adds a new request to the list of pending requests
     * @method add
     * @param request The request to queue
     */
    function add(request) {
        request.queueTime = (new Date()).getTime();
        store.push(request);
        save();
    }

    /**
     * If there are any requests queued, attempts to send the next one
     * Otherwise, does nothing
     * @method run
     */
    function run() {
        var nextRequest = next();

        if (!nextRequest) {
            return;
        }

        // Send this request, then try run again.
        sendRequest(nextRequest, run);
    }

    /**
     * Convenience function to add and run a request all in one go.
     * @method addAndRun
     * @param request {Object} The request to queue and run.
     */
    function addAndRun(request) {
        add(request);
        run();
    }

    /**
     * Init
     * @method init
     * @private
     */
    function init() {
        // Attempt to fetch the existing store from localStorage, if there is one.
        try {
            if (window.localStorage) {
                var storeData = window.localStorage.getItem(storageKey);
                if (storeData) {
                    store = JSON.parse(storeData);
                }
            }
        } catch (error) {
        }

        // If any tracking calls are made whilst offline, try sending them the next time the device comes online
        if (window.addEventListener) {
            window.addEventListener("online", run);
        }

        // On startup, try sending any requests queued from a previous session.
        run();
    }

    init();

    return {
        add: add,
        run: run,
        addAndRun: addAndRun
    };
}(Track, window, XMLHttpRequest, ActiveXObject));
