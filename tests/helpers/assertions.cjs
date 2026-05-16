/**
 * @param {{ roads: Iterable<string> }} solution
 * @returns {string[]}
 */
function sortedRoads(solution) {
  return [...solution.roads].sort();
}

module.exports = {
  sortedRoads
};
