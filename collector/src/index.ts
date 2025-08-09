import { Duke } from "./duke.ts";
import fs from "fs";
import chalk from "chalk";

async function update_sensor(data: any) {
    // This function can be used if you want to do additional processing
    // For now, the Duke class handles all the data export
    console.log(chalk.blue("Data processing completed by Duke class"));
}

async function main() {
    console.log(chalk.green("Starting Duke Energy Data Collection..."));
    
    // Create database store function (optional)
    const db_store = async (raw_data: any) => {
        // Optional: add any additional data processing here
        // The Duke class already handles storage and export
        console.log(chalk.blue(`Database store called with ${raw_data.length} records`));
    };

    // Create Duke instance and run once
    const duke = new Duke({ db_store });
    
    // For daily scheduled execution, use fetch_once instead of monitor
    await duke.fetch_once();
}

// Handle uncaught errors
process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error(chalk.red('Uncaught Exception:'), error);
    process.exit(1);
});

// Run the main function
main().catch((error) => {
    console.error(chalk.red('Error in main function:'), error);
    process.exit(1);
});