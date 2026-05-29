/**
 * @param {Window & { CityBuilderDefaults?: unknown }} globalObject
 */
(function attachPlannerDefaults(globalObject) {
  const SAMPLE_GRID = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0]
  ];

  const DEFAULT_SERVICE_TYPES = [
    { name: "Elementary School", bonus: "126", size: "2x2", effective: "12x12", avail: "1" },
    { name: "Town Bank", bonus: "224", size: "2x2", effective: "12x12", avail: "1" },
    { name: "Health Clinic", bonus: "108", size: "2x2", effective: "10x10", avail: "1" },
    { name: "Gas Station", bonus: "118", size: "2x2", effective: "12x12", avail: "1" },
    { name: "Townsquare", bonus: "115", size: "2x2", effective: "10x10", avail: "1" },
    { name: "Fire Station", bonus: "204", size: "2x2", effective: "10x10", avail: "1" },
    { name: "Mining Museum", bonus: "224", size: "2x2", effective: "12x12", avail: "1" },
    { name: "Square", bonus: "364", size: "2x3", effective: "10x11", avail: "1" },
    { name: "Park", bonus: "215", size: "2x3", effective: "12x13", avail: "1" },
    { name: "Congress Center", bonus: "270", size: "4x2", effective: "14x12", avail: "1" },
    { name: "Cinema", bonus: "189", size: "2x2", effective: "10x10", avail: "1" },
    { name: "Supermarket", bonus: "386", size: "3x2", effective: "13x12", avail: "1" }
  ];

  const DEFAULT_RESIDENTIAL_TYPES = [
    { name: "Suburban Residence", resident: "150/450", size: "2x2", avail: "3" },
    { name: "The Belvedere", resident: "520/1560", size: "2x3", avail: "2" },
    { name: "The Aurora", resident: "600/1800", size: "2x2", avail: "1" },
    { name: "Radiant Residence", resident: "260/780", size: "2x3", avail: "2" },
    { name: "The Metropolis", resident: "480/1440", size: "2x3", avail: "2" },
    { name: "The Rockefeller", resident: "260/780", size: "2x2", avail: "2" },
    { name: "The Gatsby", resident: "320/960", size: "2x2", avail: "2" },
    { name: "Monrose Residences", resident: "160/480", size: "2x2", avail: "2" },
    { name: "The Palisades", resident: "240/720", size: "2x3", avail: "3" },
    { name: "The Ambassador", resident: "540/1620", size: "2x3", avail: "2" },
    { name: "Pinnacle suites", resident: "720/2160", size: "2x3", avail: "2" },
    { name: "The Elysian", resident: "250/750", size: "2x3", avail: "3" },
    { name: "The Broadway", resident: "750/2250", size: "2x3", avail: "2" },
    { name: "Opal Vista", resident: "500/1500", size: "2x3", avail: "1" },
    { name: "The Eisenhower", resident: "280/840", size: "2x2", avail: "2" },
    { name: "The Grand Eden", resident: "300/900", size: "2x2", avail: "1" },
    { name: "Celestial", resident: "300/900", size: "2x2", avail: "1" },
    { name: "The Jetset", resident: "480/1440", size: "2x2", avail: "1" },
    { name: "The Cosmopolitan", resident: "500/1500", size: "2x3", avail: "2" },
    { name: "Golden Era Estates", resident: "720/2160", size: "2x3", avail: "2" },
    { name: "Heritage House", resident: "300/900", size: "2x2", avail: "2" },
    { name: "Vintage Vista", resident: "140/420", size: "2x2", avail: "2" },
    { name: "Serenade Pointe", resident: "500/1500", size: "2x2", avail: "1" },
    { name: "Serene Heights", resident: "150/450", size: "2x2", avail: "1" }
  ];

  globalObject.CityBuilderDefaults = Object.freeze({
    DEFAULT_RESIDENTIAL_TYPES,
    DEFAULT_SERVICE_TYPES,
    SAMPLE_GRID
  });
})(window);
