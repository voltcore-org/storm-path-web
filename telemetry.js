(function () {
  var SRC = "storm-path";
  var URL = "https://core-api.dominic-calandro1991.workers.dev/api/v1/events";
  var NWS = "https://api.weather.gov/alerts/active/count";
  var RADAR =
    "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?service=WMS&version=1.1.1&request=GetMap&layers=conus_bref_qcd&format=image/png&transparent=true&srs=CRS:84&bbox=-90,37,-88,39&width=64&height=64";
  var UA = "StormPath/1.0 (voltcore-org telemetry; https://github.com/voltcore-org/storm-path)";
  var frames = 0;
  var last = performance.now();
  var fps = 0;
  var gpsAccuracy = 0;
  var gpsState = "unavailable";
  var nwsOk = false;
  var radarOk = false;

  function tick(t) {
    frames += 1;
    if (t - last >= 1000) {
      fps = frames;
      frames = 0;
      last = t;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function emit(type, severity, payload) {
    try {
      fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: SRC, type: type, severity: severity, payload: payload || {} }),
        keepalive: true,
      }).catch(function () {});
    } catch (err) {}
  }

  function accuracyQuality(meters) {
    if (typeof meters !== "number" || !isFinite(meters) || meters < 0) return 0;
    return Math.max(0, Math.min(1, 1 - (meters - 5) / 50));
  }

  function sampleGps() {
    if (!navigator.geolocation) {
      gpsState = "unsupported";
      gpsAccuracy = 0;
      return;
    }
    try {
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          var meters = pos && pos.coords ? pos.coords.accuracy : NaN;
          gpsAccuracy = accuracyQuality(meters);
          gpsState = "fix";
        },
        function (err) {
          gpsAccuracy = 0;
          gpsState = err && err.code === 1 ? "denied" : "unavailable";
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 8000 }
      );
    } catch (err) {
      gpsState = "unavailable";
      gpsAccuracy = 0;
    }
  }

  function probeNws() {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
    fetch(NWS, {
      method: "GET",
      headers: { Accept: "application/ld+json", "User-Agent": UA },
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        nwsOk = Boolean(res.ok);
      })
      .catch(function () {
        nwsOk = false;
      })
      .then(function () {
        if (timer) clearTimeout(timer);
      });
  }

  function probeRadar() {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;
    fetch(RADAR, { method: "GET", signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        if (!res.ok) {
          radarOk = false;
          return null;
        }
        return res.arrayBuffer();
      })
      .then(function (buf) {
        if (buf) radarOk = buf.byteLength > 32;
      })
      .catch(function () {
        radarOk = false;
      })
      .then(function () {
        if (timer) clearTimeout(timer);
      });
  }

  function health() {
    var gpsEl = document.getElementById("top-gps-label");
    var radarEl = document.getElementById("top-radar-label");
    return {
      status: "live",
      surface: "web",
      gps_accuracy: gpsAccuracy,
      gps_state: gpsState,
      nws_radar_status: radarOk,
      weather_api_health: nwsOk,
      frame_rate: fps,
      gps_label: gpsEl && gpsEl.textContent ? String(gpsEl.textContent).trim() : "",
      radar_label: radarEl && radarEl.textContent ? String(radarEl.textContent).trim() : "",
    };
  }

  window.addEventListener("error", function (e) {
    emit("runtime.error", "error", Object.assign({ message: String(e.message || "") }, health()));
  });
  window.addEventListener("unhandledrejection", function (e) {
    emit("runtime.error", "error", Object.assign({ reason: String(e.reason || "") }, health()));
  });

  function beat(type) {
    emit(type, "info", health());
  }

  sampleGps();
  probeNws();
  probeRadar();
  setTimeout(function () {
    beat("app.event");
  }, 1600);
  setInterval(function () {
    sampleGps();
    probeNws();
    probeRadar();
    setTimeout(function () {
      beat("health.heartbeat");
    }, 1600);
  }, 30000);
})();
