(function () {
  "use strict";

  var MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  var DAY_MS = 86400000;

  function formatDateKey(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function parseDateKey(key) {
    var parts = key.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function getSourceClass(day) {
    if (!day || day.total <= 0) {
      return "source-none";
    }
    if (day.github > 0 && day.private > 0) {
      return "source-both";
    }
    if (day.github > 0) {
      return "source-github";
    }
    if (day.private > 0) {
      return "source-private";
    }
    return "source-none";
  }

  function getIntensity(total, thresholds) {
    if (!total || total <= 0) {
      return 0;
    }
    if (total <= thresholds[0]) {
      return 1;
    }
    if (total <= thresholds[1]) {
      return 2;
    }
    if (total <= thresholds[2]) {
      return 3;
    }
    return 4;
  }

  function computeThresholds(days) {
    var totals = days
      .map(function (day) {
        return day.total;
      })
      .filter(function (total) {
        return total > 0;
      })
      .sort(function (a, b) {
        return a - b;
      });

    if (!totals.length) {
      return [1, 2, 3];
    }

    var max = totals[totals.length - 1];
    if (max <= 1) {
      return [1, 1, 1];
    }

    return [
      Math.max(1, Math.ceil(max * 0.25)),
      Math.max(2, Math.ceil(max * 0.5)),
      Math.max(3, Math.ceil(max * 0.75)),
    ];
  }

  function buildDayTooltip(day) {
    if (!day || day.total <= 0) {
      return day.date + "\nNo activity";
    }

    return (
      day.date +
      "\nGitHub: " +
      day.github +
      "\nSelf-hosted Git: " +
      day.private +
      "\nTotal: " +
      day.total
    );
  }

  function buildRollingDays(dataByDate, endDate) {
    var days = [];
    var startDate = new Date(endDate.getTime() - DAY_MS * 364);

    for (
      var cursor = new Date(startDate.getTime());
      cursor <= endDate;
      cursor = new Date(cursor.getTime() + DAY_MS)
    ) {
      var key = formatDateKey(cursor);
      var entry = dataByDate[key];
      days.push(
        entry || {
          date: key,
          github: 0,
          private: 0,
          total: 0,
        },
      );
    }

    return days;
  }

  function renderCalendar(container, days) {
    var thresholds = computeThresholds(days);
    var totalCommits = days.reduce(function (sum, day) {
      return sum + day.total;
    }, 0);
    var activeDays = days.filter(function (day) {
      return day.total > 0;
    }).length;
    var startRow = parseDateKey(days[0].date).getDay();
    var latestMonth = -1;
    var lastGridColumn = -1;

    container.innerHTML =
      '<div class="git-activity-outer">' +
      '<div class="git-activity-inner">' +
      '<div class="git-activity-calendar" role="img" aria-label="Git activity heatmap for the last 365 days">' +
      ["Mon", "Wed", "Fri"]
        .map(function (label) {
          return '<span class="git-activity-week">' + label + "</span>";
        })
        .join("") +
      '<div class="git-activity-tiles"></div>' +
      '<div class="git-activity-summary">' +
      activeDays +
      " active days, " +
      totalCommits +
      " total events in the last 365 days" +
      "</div>" +
      '<div class="git-activity-legend-grid">' +
      "Less" +
      [1, 2, 3, 4]
        .map(function (level) {
          return (
            '<i class="git-activity-tile source-github intensity-' +
            level +
            '" aria-hidden="true"></i>'
          );
        })
        .join("") +
      "More" +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>";

    var calendar = container.querySelector(".git-activity-calendar");
    var tilesContainer = container.querySelector(".git-activity-tiles");
    var monthFragment = document.createDocumentFragment();
    var tilesFragment = document.createDocumentFragment();

    days.forEach(function (day, index) {
      var date = parseDateKey(day.date);
      var month = date.getMonth();
      var sourceClass = getSourceClass(day);
      var intensity = getIntensity(day.total, thresholds);
      var tile = document.createElement("i");

      tile.className =
        "git-activity-tile " + sourceClass + " intensity-" + intensity;
      tile.title = buildDayTooltip(day);
      tile.setAttribute("aria-label", buildDayTooltip(day));
      tile.dataset.date = day.date;

      if (index === 0) {
        tile.style.gridRow = String(startRow + 1);
      }

      if (date.getDay() === 0 && month !== latestMonth) {
        var gridColumn = 2 + Math.floor((index + startRow) / 7);
        if (gridColumn - lastGridColumn <= 1) {
          gridColumn += 2 - gridColumn + lastGridColumn;
        }
        lastGridColumn = gridColumn;
        latestMonth = month;

        var monthLabel = document.createElement("span");
        monthLabel.className = "git-activity-month";
        monthLabel.textContent = MONTH_NAMES[month];
        monthLabel.style.gridColumn = String(gridColumn);
        monthFragment.appendChild(monthLabel);
      }

      tilesFragment.appendChild(tile);
    });

    calendar.insertBefore(monthFragment, tilesContainer);
    tilesContainer.appendChild(tilesFragment);
  }

  function showError(container, message) {
    container.innerHTML =
      '<div class="git-activity-error" role="alert">' + message + "</div>";
  }

  function initHeatmap(root) {
    if (!root || root.dataset.gitActivityReady === "true") {
      return;
    }

    var src = root.dataset.src;
    if (!src) {
      showError(root, "Activity data source is not configured.");
      return;
    }

    root.dataset.gitActivityReady = "loading";
    root.innerHTML = "";

    fetch(src)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Failed to load activity data.");
        }
        return response.json();
      })
      .then(function (rows) {
        if (!Array.isArray(rows)) {
          throw new Error("Activity data must be a JSON array.");
        }

        var dataByDate = {};
        rows.forEach(function (row) {
          if (!row || !row.date) {
            return;
          }

          var github = Number(row.github) || 0;
          var priv = Number(row.private) || 0;
          var total = Number(row.total);
          if (!Number.isFinite(total)) {
            total = github + priv;
          }

          dataByDate[row.date] = {
            date: row.date,
            github: github,
            private: priv,
            total: total,
          };
        });

        var endDate = new Date();
        endDate.setHours(0, 0, 0, 0);
        var days = buildRollingDays(dataByDate, endDate);
        renderCalendar(root, days);
        root.dataset.gitActivityReady = "true";
      })
      .catch(function () {
        root.dataset.gitActivityReady = "error";
        showError(
          root,
          "Could not load activity data. Check that the JSON file exists and is valid.",
        );
      });
  }

  function initAll() {
    document.querySelectorAll("[data-git-activity-root]").forEach(function (root) {
      root.dataset.gitActivityReady = "false";
      initHeatmap(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }

  window.addEventListener("pjax:success", initAll);
})();
