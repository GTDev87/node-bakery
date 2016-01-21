/*jslint indent: 2, node: true, nomen: true, plusplus: true, todo: true, vars: true, white: true */
/*global Uint8Array,nacl,sjcl */
var nacl = require("tweetnacl");
var sjcl = require("sjcl");

var Macaroon = require("./lib/").Macaroon;
var asserts = require("./lib/asserts");
var hash = require("./lib/hash");

function macaroon() {
  'use strict';
  var exports = {};

  // Shim slice on Uint8Array.
  if (Uint8Array.prototype.slice === undefined) {
    Uint8Array.prototype.slice = function(begin, end) {
      // IE < 9 gets unhappy with an undefined end argument
      end = (end !== undefined) ? end : this.length;

      // For array like object we handle it ourselves.
      var i, cloned = [],
        size, len = this.length;

      // Handle negative value for "begin"
      var start = begin || 0;
      start = (start >= 0) ? start : Math.max(0, len + start);

      // Handle negative value for "end"
      var upTo = (typeof end === 'number') ? Math.min(end, len) : len;
      if (end < 0) {
        upTo = len + end;
      }

      // Actual expected size of the slice
      size = upTo - start;

      if (size > 0) {
        cloned = new Uint8Array(size);
        if (this.charAt) {
          for (i = 0; i < size; i++) {
            cloned[i] = this.charAt(start + i);
          }
        } else {
          for (i = 0; i < size; i++) {
            cloned[i] = this[start + i];
          }
        }
      }

      return cloned;
    };
  }

  // newMacaroon returns a new macaroon with the given
  // root key, identifier and location.
  // The root key must be an sjcl bitArray.
  // TODO accept string, Buffer, for root key?
  exports.newMacaroon = function(rootKey, id, loc) {
    var m = new Macaroon();
    m._caveats = [];
    asserts.assertString(loc, 'macaroon location');
    asserts.assertString(id, 'macaroon identifier');
    asserts.assertUint8Array(rootKey, 'macaroon root key');
    rootKey = hash.makeKey(rootKey);
    m._location = loc;
    m._identifier = id;
    m._signature = hash.keyedHash(rootKey, sjcl.codec.utf8String.toBits(id));
    return m;
  };

  // import converts an object as deserialised from
  // JSON to a macaroon. It also accepts an array of objects,
  // returning the resulting array of macaroons.
  exports.import = function(obj) {
    if (obj.constructor === Array) {
      return obj.map(function(value) {
        return exports.import(value);
      });
    }
    var m = new Macaroon();
    m._signature = sjcl.codec.hex.toBits(obj.signature);
    asserts.assertString(obj.location, 'macaroon location');
    m._location = obj.location;
    asserts.assertString(obj.identifier, 'macaroon identifier');
    m._identifier = obj.identifier;

    m._caveats = obj.caveats.map(function(jsonCav) {
        var cav = {
            _identifier: null,
            _location: null,
            _vid: null,
        };
        if (jsonCav.cl !== undefined) {
            asserts.assertString(jsonCav.cl, 'caveat location');
            cav._location = jsonCav.cl;
        }
        if (jsonCav.vid !== undefined) {
            asserts.assertString(jsonCav.vid, 'caveat verification id');
            // Use URL encoding.
            cav._vid = sjcl.codec.base64.toBits(jsonCav.vid, true);
        }
        asserts.assertString(jsonCav.cid, 'caveat id');
        cav._identifier = jsonCav.cid;
        return cav;
    });
    return m;
  };

  // export converts a macaroon or array of macaroons
  // to the exported object form, suitable for encoding as JSON.
  exports.export = function(m) {
    if (m.constructor === Array) {
        return m.map(function(value) {
            return exports.export(value);
        });
    }
    return {
        location: m._location,
        identifier: m._identifier,
        signature: sjcl.codec.hex.fromBits(m._signature),
        caveats: m._caveats.map(function(cav) {
            var cavObj = {
                cid: cav._identifier,
            };
            if (cav._vid !== null) {
                // Use URL encoding and do not append "=" characters.
                cavObj.vid = sjcl.codec.base64.fromBits(cav._vid, true, true);
                cavObj.cl = cav._location;
            }
            return cavObj;
        })
    };
  };

  // discharge gathers discharge macaroons for all the third party caveats
  // in m (and any subsequent caveats required by those) calling getDischarge to
  // acquire each discharge macaroon.
  //
  // On success, it calls onOk with an array argument
  // holding m as the first element, followed by
  // all the discharge macaroons. All the discharge macaroons
  // will be bound to the primary macaroon.
  //
  // On failure, it calls onError with any error encountered.
  //
  // The getDischarge argument should be a function that
  // is passed five parameters: the value of m.location(),
  // the location of the third party, the third party caveat id,
  // all strings, a callback function to call with the acquired
  // macaroon on success, and a callback function to call with
  // any error on failure.
  exports.discharge = function(m, getDischarge, onOk, onError) {
    var primarySig = m.signature();
    var discharges = [m];
    var pendingCount = 0;
    var errorCalled = false;
    var firstPartyLocation = m.location();
    var dischargeCaveats;
    var dischargedCallback = function(dm) {
      if (errorCalled) {
        return;
      }
      dm.bind(primarySig);
      discharges.push(dm);
      pendingCount--;
      dischargeCaveats(dm);
    };
    var dischargedErrorCallback = function(err) {
      if (!errorCalled) {
        onError(err);
        errorCalled = true;
      }
    };
    dischargeCaveats = function(m) {
      var cav, i;
      for (i = 0; i < m._caveats.length; i++) {
        cav = m._caveats[i];
        if (cav._vid !== null) {
            getDischarge(
                firstPartyLocation,
                cav._location,
                cav._identifier,
                dischargedCallback,
                dischargedErrorCallback);
            pendingCount++;
        }
      }
      if (pendingCount === 0) {
        onOk(discharges);
        return;
      }
    };
    dischargeCaveats(m);
  };


  

  

  return exports;
}

module.exports = macaroon()
