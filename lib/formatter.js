/**
 * Formatter constructor.
 * @param {*} object the AMIs to region mapping object.
 */
const formatter = function (object) {
  this.object = object;
};

/**
 * Text formatter.
 */
formatter.prototype.text = function () {
  Object.keys(this.object).forEach((region) => {
    console.log(`  Region ${region} - ${this.object[region]}`);
  });
};

/**
 * JSON formatter.
 */
formatter.prototype.json = function () {
  const entries = {};

  // Creating the entries.
  Object.keys(this.object).map((region) => {
    entries[region] = { 'AMI': this.object[region] };
  });
  // Pretty-printing the JSON object.
  console.log(JSON.stringify({ AmiRegionMap: entries }, null, 2));
};

/**
 * YAML formatter.
 */
formatter.prototype.yaml = function () {
  console.log('AmiRegionMap:');
  Object.keys(this.object).forEach((region) => {
    console.log(`  ${region}:\n    AMI: ${this.object[region]}`);
  });
};

module.exports = formatter;