#!/usr/bin/env bun

import { Command } from "commander";
import { generate } from "./generate";

interface CliOptions {
  output?: string;
  debug?: boolean;
  store?: string;
}

const program = new Command()
  .name("bulletin-generator")
  .description("Generate a one-sheet landscape-A4 bulletin from YAML")
  .argument("<bulletin.yaml>", "bulletin YAML file")
  .option("-o, --output <path>", "output PDF path")
  .option("--store <filepath>", "song store YAML file")
  .option("--debug", "draw column guides")
  .action(async (yamlFile: string, options: CliOptions) => {
    try {
      const destination = await generate(yamlFile, options.output, options.debug, options.store);
      console.log(destination);
    } catch (error) {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
  });

await program.parseAsync();
