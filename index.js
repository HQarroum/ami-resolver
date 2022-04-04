#!/usr/bin/env node

const program   = require('commander');
const AWS       = require('aws-sdk');
const Joi       = require('joi');
const Chain     = require('middleware-chain-js');
const Pool      = require('promise-pool-js');
const Formatter = require('./lib/formatter');

// Creating a new middleware chain and a promise pool.
const chain = new Chain();
const pool  = new Pool(5);

// Retrieving package informations.
const { version, description, name } = require('./package.json');

/**
 * Validation schema for parameters.
 */
const schema = Joi.object().keys({
  region: Joi.string().required(),
  ami: Joi.any(),
  name: Joi.any(),
  output: Joi.string().valid(['json', 'yaml', 'text']).default('text').optional()
}).xor('ami', 'name').required();

/**
 * Exits the application with an error message
 * and an appropriate error code.
 */
const fail = (type, message) => {
  console.error(`[!] An error occured - ${type} - ${message}`);
  process.exit(1);
};

/**
 * Command-line interface.
 */
program
  .version(version)
  .name(name)
  .description(description)
  .option('-r, --region <region>', 'The AWS region the given base AMI is associated with.')
  .option('-a, --ami <ami>', 'The base AMI associated with the given region to resolve in other AWS regions.')
  .option('-n, --ami-name <ami-name>', 'The name of an AMI associated with the given region to resolve in other AWS regions.')
  .option('-o, --output <output>', 'The desired output format (e.g `json`, `yaml` or `text`).')
  .option('-s, --suppress-logs', 'Produces a raw output without any log messages.')
  .parse(process.argv);

/**
 * Validating parameters.
 */
chain.use((input, output, next) => {
  // Validating the input.
  const result = Joi.validate({
    region: program.region,
    ami: program.ami,
    name: program.amiName,
    output: program.output
  }, schema);
  // If the validation failed we return an error.
  if (result.error) {
    program.outputHelp();
    console.log();
    return (fail('Argument validation error', result.error.message));
  }
  // Saving the parameters.
  next(input.params = result.value);
});

/**
 * Retrieving AWS regions.
 */
chain.use((input, output, next) => {
  new AWS.EC2({ region: input.params.region })
    .describeRegions({})
    .promise()
    .then((regions) => input.regions = regions.Regions
      .map((region) => region.RegionName))
    .then(next)
    .catch((err) => fail('DescribeRegions', err));
});

/**
 * Retrieving information on the given AMI.
 */
chain.use((input, output, next) => {
  if (input.params.ami) {
    return new AWS.EC2({ region: input.params.region })
      .describeImages({ ImageIds: [ input.params.ami ] })
      .promise()
      .then((data) => input.image = data.Images[0])
      .then((image) => next(
        !program.suppressLogs && console.log(`[+] Resolved AMI '${input.params.ami}' in region '${input.params.region}' - ${image.Name ? image.Name : 'Unknown name'} - ${image.Description ? image.Description : 'No Description'} - ${image.Architecture} - ${image.VirtualizationType}`)
      ))
      .catch((err) => fail('describeImages', err));
  }
  next();
});

/**
 * Retrieving information on the given AMI name.
 */
chain.use((input, output, next) => {
  if (input.params.name) {
    return new AWS.EC2({ region: input.params.region })
      .describeImages({ Filters: [ { Name: 'name', Values: [ input.params.name ] } ] })
      .promise()
      .then((data) => {
        if (data.Images.length === 0) {
          return (Promise.reject(`The given AMI name '${input.params.name}' was not found in the given region '${input.params.region}'.`))
        }
        return (input.image = data.Images[0]);
      })
      .then((image) => next(
        !program.suppressLogs && console.log(`[+] Resolved AMI in region '${input.params.region}' - ${image.Name ? image.Name : 'Unknown name'} - ${image.Description ? image.Description : 'No Description'} - ${image.Architecture} - ${image.VirtualizationType}`)
      ))
      .catch((err) => fail('describeImages', err));
  }
  next();
});

/**
 * Retrieving the AMIs in other regions.
 */
chain.use((input, output, next) => {
  const results = {};

  !program.suppressLogs && console.log(`[+] Searching the given AMI across ${input.regions.length} AWS regions ...`);
  // Adding the initial region.
  results[input.params.region] = input.params.ami;
  // Retrieving the AMI for each available region using the promise pool.
  for (let i = 0; i < input.regions.length; ++i) {
    pool.enqueue(
      () => new AWS.EC2({ region: input.regions[i] })
        .describeImages({ Filters: [ { Name: 'name', Values: [ input.image.Name ]} ] })
        .promise()
        .then((data) => {
          // Saving the AMI for the current region when found.
          if (data.Images.length > 0) {
            results[input.regions[i]] = data.Images[0].ImageId;
          }
        })
    );
  }
  // Waiting for all requests to finish.
  pool.all().then(() => {
    !program.suppressLogs && console.log(`[+] Resolved ${Object.keys(results).length} AMIs / ${input.regions.length} AWS regions.`);
    next(input.results = results);
  });
});

/**
 * Formatting the output.
 */
chain.use((input) => {
  !program.suppressLogs && console.log(`[+] Output for the AMI '${input.params.ami}' :\n`);
  new Formatter(input.results)[input.params.output]();
});

// Triggering the middleware chain.
chain.handle({}, {});