import chalk from "chalk";
import { XMLParser } from "fast-xml-parser";
import puppeteer, {Browser} from "puppeteer";
import fs from "fs";

function sleep(ms: number) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export class Duke {
	browser: Browser | undefined;
	refresh_interval_min = 15;
	db_store: ((raw_data: any) => Promise<any>) | undefined;
	gas_history_file = '../data/gas/duke-gas-history.json';
	electric_history_file = '../data/electric/duke-electric-history.json';

	public constructor(values: Partial<Duke>) {
		Object.assign(this, values);
		if (!this.valid_config()) {
			return;
		}
		this.initHistoryFiles();
	}

	valid_config(): boolean {
		const req_config = ["EMAIL", "PASSWORD", "ACCOUNTNUM"];
		const optional_config = ["GAS_METERNUM", "ELECTRIC_METERNUM"];
		
		// Check required configs
		const hasRequired = req_config.every((config) => {
			if (!process.env[config]) {
				console.log(chalk.red(`${config} is not set in the .env config! Exiting...`));
				return false;
			}
			return true;
		});

		if (!hasRequired) return false;

		// Check that at least one meter is configured
		const hasGas = process.env.GAS_METERNUM && process.env.GAS_METERNUM.trim();
		const hasElectric = process.env.ELECTRIC_METERNUM && process.env.ELECTRIC_METERNUM.trim();

		if (!hasGas && !hasElectric) {
			console.log(chalk.red("At least one of GAS_METERNUM or ELECTRIC_METERNUM must be set in the .env config!"));
			return false;
		}

		console.log(chalk.green(`Configured for: ${hasGas ? 'Gas' : ''}${hasGas && hasElectric ? ' and ' : ''}${hasElectric ? 'Electric' : ''}`));
		return true;
	}

	// Initialize JSON history files
	initHistoryFiles(): void {
		if (process.env.GAS_METERNUM) {
			if (!fs.existsSync(this.gas_history_file)) {
				fs.writeFileSync(this.gas_history_file, JSON.stringify([], null, 2));
				console.log(chalk.green(`Created gas history file: ${this.gas_history_file}`));
			} else {
				console.log(chalk.green(`Using existing gas history file: ${this.gas_history_file}`));
			}
		}

		if (process.env.ELECTRIC_METERNUM) {
			if (!fs.existsSync(this.electric_history_file)) {
				fs.writeFileSync(this.electric_history_file, JSON.stringify([], null, 2));
				console.log(chalk.green(`Created electric history file: ${this.electric_history_file}`));
			} else {
				console.log(chalk.green(`Using existing electric history file: ${this.electric_history_file}`));
			}
		}
	}

	// Load historical data from JSON file
	loadHistoricalData(serviceType: 'GAS' | 'ELECTRIC'): any[] {
		const filename = serviceType === 'GAS' ? this.gas_history_file : this.electric_history_file;
		try {
			const data = fs.readFileSync(filename, 'utf8');
			return JSON.parse(data);
		} catch (error) {
			console.error(chalk.red(`Error loading ${serviceType.toLowerCase()} historical data:`), error);
			return [];
		}
	}

	// Store usage data in JSON file
	storeUsageData(usage_data: any[], serviceType: 'GAS' | 'ELECTRIC'): void {
		if (!usage_data || usage_data.length === 0) return;

		const filename = serviceType === 'GAS' ? this.gas_history_file : this.electric_history_file;
		let historical_data = this.loadHistoricalData(serviceType);

		// Add new data, avoiding duplicates
		for (const reading of usage_data) {
			let new_record: any;

			if (serviceType === 'GAS') {
				const usage_therms = reading.usage_ccf * 1.037; // Convert CCF to therms
				new_record = {
					date: reading.full_date,
					date_label: reading.date,
					usage_ccf: reading.usage_ccf,
					usage_therms: parseFloat(usage_therms.toFixed(3)),
					average_ccf: reading.average_ccf,
					unit: reading.unit,
					timestamp: reading.timestamp,
					created_at: new Date().toISOString()
				};
			} else {
				// Electric data structure
				new_record = {
					date: reading.full_date || reading.date,
					date_label: reading.date_label || reading.date,
					usage_kwh: reading.energy || reading.usage_kwh,
					start_time: reading.startTime,
					end_time: reading.endTime,
					unit: 'kWh',
					timestamp: reading.timestamp || new Date().toISOString(),
					created_at: new Date().toISOString()
				};
			}

			// Check if this date already exists, if so, update it
			const dateKey = serviceType === 'GAS' ? reading.full_date : (reading.full_date || reading.date);
			const existing_index = historical_data.findIndex(record => record.date === dateKey);
			
			if (existing_index >= 0) {
				historical_data[existing_index] = new_record;
				console.log(chalk.yellow(`Updated existing ${serviceType.toLowerCase()} record for ${dateKey}`));
			} else {
				historical_data.push(new_record);
				console.log(chalk.green(`Added new ${serviceType.toLowerCase()} record for ${dateKey}`));
			}
		}

		// Sort by date (oldest first)
		historical_data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

		// Keep only the last 2 years of data
		const two_years_ago = new Date();
		two_years_ago.setFullYear(two_years_ago.getFullYear() - 2);
		historical_data = historical_data.filter(record => new Date(record.date) >= two_years_ago);

		// Save back to file
		fs.writeFileSync(filename, JSON.stringify(historical_data, null, 2));
		console.log(chalk.green(`Stored ${usage_data.length} ${serviceType.toLowerCase()} usage records. Total history: ${historical_data.length} records`));
	}

	// Export data for Home Assistant in various formats
	exportForHomeAssistant(serviceType: 'GAS' | 'ELECTRIC'): void {
		const historical_data = this.loadHistoricalData(serviceType);
		const prefix = serviceType.toLowerCase();
		
		if (historical_data.length === 0) {
			console.log(chalk.yellow(`No ${prefix} historical data to export`));
			return;
		}

		// Latest reading - FIX: Write to data directory
		const latest = historical_data[historical_data.length - 1];
		fs.writeFileSync(`../data/${prefix}/duke-${prefix}-latest.json`, JSON.stringify(latest, null, 2));

		// Recent data (last 30 days) - FIX: Write to data directory
		const thirty_days_ago = new Date();
		thirty_days_ago.setDate(thirty_days_ago.getDate() - 30);
		const recent_data = historical_data.filter(record => new Date(record.date) >= thirty_days_ago);
		fs.writeFileSync(`../data/${prefix}/duke-${prefix}-recent.json`, JSON.stringify(recent_data, null, 2));

		// Monthly summaries - FIX: Write to data directory
		const monthly_summary = this.createMonthlySummary(historical_data, serviceType);
		fs.writeFileSync(`../data/${prefix}/duke-${prefix}-monthly.json`, JSON.stringify(monthly_summary, null, 2));

		// Energy stats - FIX: Write to data directory
		const energy_stats = historical_data.map(record => {
			if (serviceType === 'GAS') {
				return {
					date: record.date,
					ccf: record.usage_ccf,
					therms: record.usage_therms,
					cost_estimate: parseFloat((record.usage_ccf * 0.5685).toFixed(2)) // Your actual gas rate
				};
			} else {
				return {
					date: record.date,
					kwh: record.usage_kwh,
					cost_estimate: parseFloat((record.usage_kwh * 0.0929).toFixed(2)) // Your actual electric rate
				};
			}
		});
		fs.writeFileSync(`../data/${prefix}/duke-${prefix}-energy-stats.json`, JSON.stringify(energy_stats, null, 2));

		if (serviceType === 'GAS') {
			console.log(chalk.green(`Latest gas reading: ${latest.usage_ccf} CCF (${latest.usage_therms} therms) on ${latest.date_label}`));
		} else {
			console.log(chalk.green(`Latest electric reading: ${latest.usage_kwh} kWh on ${latest.date_label || latest.date}`));
		}
		console.log(chalk.blue(`Total ${prefix} historical records: ${historical_data.length}`));
		console.log(chalk.blue(`Recent ${prefix} records (30 days): ${recent_data.length}`));
	}

	// Create monthly usage summaries
	createMonthlySummary(historical_data: any[], serviceType: 'GAS' | 'ELECTRIC'): any[] {
		const monthly_data: { [key: string]: any } = {};

		for (const record of historical_data) {
			const date = new Date(record.date);
			const month_key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;

			if (!monthly_data[month_key]) {
				if (serviceType === 'GAS') {
					monthly_data[month_key] = {
						month: month_key,
						total_ccf: 0,
						total_therms: 0,
						days: 0,
						average_daily_ccf: 0,
						average_daily_therms: 0
					};
				} else {
					monthly_data[month_key] = {
						month: month_key,
						total_kwh: 0,
						days: 0,
						average_daily_kwh: 0
					};
				}
			}

			if (serviceType === 'GAS') {
				monthly_data[month_key].total_ccf += record.usage_ccf;
				monthly_data[month_key].total_therms += record.usage_therms;
			} else {
				monthly_data[month_key].total_kwh += record.usage_kwh;
			}
			monthly_data[month_key].days += 1;
		}

		// Calculate averages
		Object.keys(monthly_data).forEach(key => {
			const month = monthly_data[key];
			if (serviceType === 'GAS') {
				month.average_daily_ccf = parseFloat((month.total_ccf / month.days).toFixed(3));
				month.average_daily_therms = parseFloat((month.total_therms / month.days).toFixed(3));
				month.total_ccf = parseFloat(month.total_ccf.toFixed(3));
				month.total_therms = parseFloat(month.total_therms.toFixed(3));
			} else {
				month.average_daily_kwh = parseFloat((month.total_kwh / month.days).toFixed(3));
				month.total_kwh = parseFloat(month.total_kwh.toFixed(3));
			}
		});

		return Object.values(monthly_data).sort((a, b) => a.month.localeCompare(b.month));
	}

	async init(): Promise<void> {
		console.log(chalk.blue("Initializing browser..."));
		this.browser = await puppeteer.launch({
			headless: true, // Run headless for scheduled tasks
			defaultViewport: { width: 1920, height: 1080 },
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		});
		console.log(chalk.green("Browser initialized successfully!"));
	}

	async login(): Promise<void> {
		console.log(chalk.blue("Starting login process..."));
		const page = await this.browser!.newPage();
		await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0');
		
		try {
			console.log(chalk.blue("Navigating to Duke Energy login page..."));
			await page.goto("https://www.duke-energy.com/my-account/sign-in", { timeout: 60000 });
			
			console.log(chalk.blue("Waiting for email input field..."));
			await page.waitForSelector("#Split-Sign-In-signInUsername_tealeaf-unmask", { timeout: 30000 });
			
			console.log(chalk.blue("Typing email..."));
			await page.type("#Split-Sign-In-signInUsername_tealeaf-unmask", process.env.EMAIL!);
			
			console.log(chalk.blue("Waiting for password input field..."));
			await page.waitForSelector("#Split-Sign-In-signInPassword", { timeout: 10000 });
			
			console.log(chalk.blue("Typing password..."));
			await page.type("#Split-Sign-In-signInPassword", process.env.PASSWORD!);
			
			console.log(chalk.blue("Clicking submit button..."));
			await page.click("button[type=submit]");
			
			console.log(chalk.blue("Waiting for navigation after login..."));
			await page.waitForNavigation({ timeout: 60000 });
			
			console.log(chalk.green("Login completed successfully!"));
			console.log(chalk.green(`Current URL: ${page.url()}`));
			
		} catch (error) {
			console.error(chalk.red("Login failed:"), error);
			throw error;
		}
	}

	async read_gas_api(): Promise<any> {
		console.log(chalk.blue("Starting GAS API data retrieval..."));
		
		const api_url = "https://p-auth.duke-energy.com/form/PlanRate/GetEnergyUsage";
		
		// Get yesterday's date (gas data is typically 1 day behind)
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		
		// Get past 30 days from yesterday
		const thirtyDaysAgo = new Date(yesterday);
		thirtyDaysAgo.setDate(yesterday.getDate() - 30);
		
		const formatDate = (date: Date) => {
			const month = (date.getMonth() + 1).toString().padStart(2, '0');
			const day = date.getDate().toString().padStart(2, '0');
			const year = date.getFullYear();
			return `${month}/${day}/${year}`;
		};
		
		const startDate = formatDate(thirtyDaysAgo);
		const endDate = formatDate(yesterday);
		
		console.log(chalk.blue(`Requesting gas data from ${startDate} to ${endDate}`));
		
		const req_json = {
			request: JSON.stringify({
				"SrcAcctId": process.env.ACCOUNTNUM,
				"SrcAcctId2": "",
				"SrcSysCd": "ISU",
				"MeterSerialNumber": process.env.GAS_METERNUM?.trim(),
				"IntervalFrequency": "dailyEnergy",
				"Netmetering": "N",
				"PeriodType": "Month",
				"ServiceType": "GAS",
				"StartDate": startDate,
				"EndDate": endDate,
				"Date": "",
				"AgrmtStartDt": "",
				"AgrmtEndDt": "",
				"MeterCertDt": ""
			})
		};

		try {
			const api_page = await this.browser!.newPage();
			await api_page.setRequestInterception(true);
			
			api_page.once('request', request => {
				request.continue({ 
					method: 'POST', 
					postData: JSON.stringify(req_json), 
					headers: {
						"Accept": "application/json, text/plain, */*",
						"Content-Type": "application/json",
						"Cookie": request.headers().Cookie
					} 
				});
			});

			await api_page.goto(api_url, { timeout: 60000 });
			const api_response = await api_page.content();

			// Parse JSON response
			const jsonMatch = api_response.match(/\{.*\}/s);
			if (!jsonMatch) {
				throw new Error("No JSON found in gas API response");
			}

			const gas_data = JSON.parse(jsonMatch[0]);
			console.log(chalk.green("Successfully parsed gas JSON response!"));
			
			// Save raw response
			fs.writeFileSync("../data/gas/duke-gas-raw.json", JSON.stringify(gas_data, null, 2));
			
			// Process the data
			const processed_data = this.processGasData(gas_data);
			
			// Store and export
			this.storeUsageData(processed_data, 'GAS');
			this.exportForHomeAssistant('GAS');
			
			console.log(chalk.green(`Successfully processed ${processed_data.length} days of gas usage data`));
			return processed_data;
			
		} catch (error) {
			console.error(chalk.red("Error in gas API:"), error);
			throw error;
		}
	}

	async read_electric_api(): Promise<any> {
		console.log(chalk.blue("Starting ELECTRIC API data retrieval..."));
		
		const api_url = "https://p-auth.duke-energy.com/form/PlanRate/GetEnergyUsage";
		
		// Get yesterday's data (electric data is also typically 1 day behind)
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		
		// Get past 7 days from yesterday for electric data
		const sevenDaysAgo = new Date(yesterday);
		sevenDaysAgo.setDate(yesterday.getDate() - 7);
		
		const formatDate = (date: Date) => {
			const month = (date.getMonth() + 1).toString().padStart(2, '0');
			const day = date.getDate().toString().padStart(2, '0');
			const year = date.getFullYear();
			return `${month}/${day}/${year}`;
		};
		
		const startDate = formatDate(sevenDaysAgo);
		const endDate = formatDate(yesterday);
		
		console.log(chalk.blue(`Requesting electric data from ${startDate} to ${endDate}`));
		
		const req_json = {
			request: JSON.stringify({
				"SrcAcctId": process.env.ACCOUNTNUM,
				"SrcAcctId2": "",
				"SrcSysCd": "ISU",
				"MeterSerialNumber": process.env.ELECTRIC_METERNUM?.trim(),
				"IntervalFrequency": "dailyEnergy", // Get daily totals instead of 15-minute intervals
				"Netmetering": "N",
				"PeriodType": "Week",
				"ServiceType": "ELECTRIC",
				"StartDate": startDate,
				"EndDate": endDate,
				"Date": "",
				"AgrmtStartDt": "",
				"AgrmtEndDt": "",
				"MeterCertDt": ""
			})
		};

		try {
			const api_page = await this.browser!.newPage();
			await api_page.setRequestInterception(true);
			
			api_page.once('request', request => {
				request.continue({ 
					method: 'POST', 
					postData: JSON.stringify(req_json), 
					headers: {
						"Accept": "application/json, text/plain, */*",
						"Content-Type": "application/json",
						"Cookie": request.headers().Cookie
					} 
				});
			});

			await api_page.goto(api_url, { timeout: 60000 });
			const api_response = await api_page.content();

			// Try JSON first (like gas data)
			let electric_data;
			const jsonMatch = api_response.match(/\{.*\}/s);
			if (jsonMatch) {
				try {
					electric_data = JSON.parse(jsonMatch[0]);
					console.log(chalk.green("Successfully parsed electric JSON response!"));
					
					// Save raw response
					fs.writeFileSync("../data/electric/duke-electric-raw.json", JSON.stringify(electric_data, null, 2));
					
					// Process as JSON (similar to gas data)
					const processed_data = this.processElectricJsonData(electric_data);
					
					// Store and export
					this.storeUsageData(processed_data, 'ELECTRIC');
					this.exportForHomeAssistant('ELECTRIC');
					
					console.log(chalk.green(`Successfully processed ${processed_data.length} days of electric usage data`));
					return processed_data;
					
				} catch (jsonError) {
					console.log(chalk.yellow("JSON parsing failed, trying XML..."));
				}
			}
			
			// Fallback to XML parsing (original method)
			console.log(chalk.blue("Parsing as XML..."));
			const parser = new XMLParser();
			const parsed_xml = parser.parse(api_response);
			
			const raw_data = parsed_xml["html"]["body"]["ns3:entry"]["ns3:link"]["ns3:content"];
			const data = raw_data["espi:intervalblock"];
			const reading_interval = data["espi:interval"]["espi:secondsperinterval"];
			const readings = data["espi:intervalreading"].map((reading: any) => {
				if (reading["espi:readingquality"] != "ACTUAL") {
					return undefined;
				}
				return {
					time: reading["espi:timeperiod"]["espi:start"],
					value: reading["espi:value"]
				};
			}).filter((x: any) => x !== undefined);
			
			console.log(chalk.green(`Successfully parsed electric XML data! ${readings.length} readings`));
			
			// Save raw response
			fs.writeFileSync("../data/electric/duke-electric-raw.json", JSON.stringify(raw_data, null, 2));
			
			// Group readings by day and sum them
			const dailyData = this.groupElectricReadingsByDay(readings, reading_interval);
			
			// Store and export
			this.storeUsageData(dailyData, 'ELECTRIC');
			this.exportForHomeAssistant('ELECTRIC');
			
			console.log(chalk.green(`Successfully processed ${dailyData.length} days of electric usage data`));
			return dailyData;
			
		} catch (error) {
			console.error(chalk.red("Error in electric API:"), error);
			throw error;
		}
	}

	// Process electric data when it comes back as JSON (like gas data)
	processElectricJsonData(raw_data: any): any[] {
		try {
			if (!raw_data.Series1 || !raw_data.TickSeries) {
				console.log(chalk.yellow("No electric usage data found in JSON response"));
				return [];
			}

			const usage_values = raw_data.Series1;
			const date_labels = raw_data.TickSeries;
			
			const processed_data = [];
			const current_year = new Date().getFullYear();
			
			for (let i = 0; i < usage_values.length; i++) {
				const usage = parseFloat(usage_values[i]);
				const date_label = date_labels[i];
				
				// Parse the date (M/DD format)
				let full_date;
				try {
					if (date_label && date_label.includes('/')) {
						const [month, day] = date_label.split('/');
						if (month && day) {
							full_date = `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${current_year}`;
						} else {
							throw new Error("Invalid date format");
						}
					} else {
						throw new Error("No slash in date");
					}
				} catch {
					console.log(chalk.yellow(`Invalid electric date format: ${date_label}, skipping this record`));
					continue;
				}
				
				processed_data.push({
					date: date_label,
					full_date: full_date,
					usage_kwh: usage,
					unit: raw_data.UnitOfMeasure || "kWh",
					timestamp: new Date().toISOString()
				});
			}
			
			// Sort by date
			processed_data.sort((a, b) => new Date(a.full_date).getTime() - new Date(b.full_date).getTime());
			
			console.log(chalk.green(`Processed ${processed_data.length} days of electric usage`));
			
			if (processed_data.length > 0) {
				const latest = processed_data[processed_data.length - 1];
				console.log(chalk.green(`Most recent electric usage: ${latest.usage_kwh} ${latest.unit} on ${latest.date}`));
			}
			
			return processed_data;
			
		} catch (error) {
			console.error(chalk.red("Error processing electric JSON data:"), error);
			return [];
		}
	}

	// Group electric readings by day (for XML interval data)
	groupElectricReadingsByDay(readings: any[], reading_interval: number): any[] {
		const dailyTotals: { [key: string]: { total: number, date: Date } } = {};
		
		for (const reading of readings) {
			const date = new Date(reading.time * 1000);
			const dateKey = date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
			
			if (!dailyTotals[dateKey]) {
				dailyTotals[dateKey] = { total: 0, date: date };
			}
			
			// Convert Wh to kWh (readings are typically in Wh)
			const kwh = parseFloat(reading.value) / 1000;
			dailyTotals[dateKey].total += kwh;
		}
		
		// Convert to array format
		return Object.keys(dailyTotals).map(dateKey => {
			const dayData = dailyTotals[dateKey];
			return {
				date: dateKey,
				full_date: dateKey,
				usage_kwh: parseFloat(dayData.total.toFixed(3)),
				unit: "kWh",
				timestamp: new Date().toISOString()
			};
		}).sort((a, b) => new Date(a.full_date).getTime() - new Date(b.full_date).getTime());
	}

	processGasData(raw_data: any): any[] {
		try {
			if (!raw_data.Series1 || !raw_data.TickSeries) {
				console.log(chalk.yellow("No gas usage data found in response"));
				return [];
			}

			const usage_values = raw_data.Series1;
			const average_values = raw_data.Series2;
			const date_labels = raw_data.TickSeries;
			
			const processed_data = [];
			const current_year = new Date().getFullYear();
			
			for (let i = 0; i < usage_values.length; i++) {
				const usage = parseFloat(usage_values[i]);
				const average = average_values && average_values[i] ? parseFloat(average_values[i]) : null;
				const date_label = date_labels[i];
				
				// Parse the date (M/DD format)
				let full_date;
				try {
					if (date_label && date_label.includes('/')) {
						const [month, day] = date_label.split('/');
						if (month && day) {
							full_date = `${month.padStart(2, '0')}/${day.padStart(2, '0')}/${current_year}`;
						} else {
							throw new Error("Invalid date format");
						}
					} else {
						throw new Error("No slash in date");
					}
				} catch {
					console.log(chalk.yellow(`Invalid gas date format: ${date_label}, skipping this record`));
					continue;
				}
				
				processed_data.push({
					date: date_label,
					full_date: full_date,
					usage_ccf: usage,
					average_ccf: average,
					unit: raw_data.UnitOfMeasure || "CCF",
					timestamp: new Date().toISOString()
				});
			}
			
			// Sort by date
			processed_data.sort((a, b) => new Date(a.full_date).getTime() - new Date(b.full_date).getTime());
			
			console.log(chalk.green(`Processed ${processed_data.length} days of gas usage`));
			
			if (processed_data.length > 0) {
				const latest = processed_data[processed_data.length - 1];
				console.log(chalk.green(`Most recent gas usage: ${latest.usage_ccf} ${latest.unit} on ${latest.date}`));
			}
			
			return processed_data;
			
		} catch (error) {
			console.error(chalk.red("Error processing gas data:"), error);
			return [];
		}
	}

	async fetch_once(): Promise<void> {
		const start_time = new Date();
		console.log(chalk.blue(`=== Starting Duke Energy Data Fetch at ${start_time.toISOString()} ===`));
		
		try {
			await this.init();
			await this.login();
			
			console.log(chalk.blue("Login successful, now fetching usage data..."));
			
			const results = {
				gas: { success: false, error: null as any, data_points: 0 },
				electric: { success: false, error: null as any, data_points: 0 }
			};
			
			// Fetch gas data if configured
			if (process.env.GAS_METERNUM) {
				try {
					console.log(chalk.blue("--- Fetching Gas Data ---"));
					const gas_data = await this.read_gas_api();
					results.gas.success = true;
					results.gas.data_points = gas_data.length;
					console.log(chalk.green(`âœ… Gas data collection completed: ${gas_data.length} records`));
				} catch (error) {
					results.gas.error = error;
					console.error(chalk.red("âŒ Failed to fetch gas data:"), error);
				}
			} else {
				console.log(chalk.yellow("â­ï¸  Gas meter not configured, skipping gas data collection"));
			}
			
			// Fetch electric data if configured
			if (process.env.ELECTRIC_METERNUM) {
				try {
					console.log(chalk.blue("--- Fetching Electric Data ---"));
					const electric_data = await this.read_electric_api();
					results.electric.success = true;
					results.electric.data_points = electric_data.length;
					console.log(chalk.green(`âœ… Electric data collection completed: ${electric_data.length} records`));
				} catch (error) {
					results.electric.error = error;
					console.error(chalk.red("âŒ Failed to fetch electric data:"), error);
				}
			} else {
				console.log(chalk.yellow("â­ï¸  Electric meter not configured, skipping electric data collection"));
			}
			
			// Summary
			console.log(chalk.blue("=== Collection Summary ==="));
			if (process.env.GAS_METERNUM) {
				if (results.gas.success) {
					console.log(chalk.green(`Gas: âœ… Success (${results.gas.data_points} records)`));
				} else {
					console.log(chalk.red(`Gas: âŒ Failed - ${results.gas.error?.message || 'Unknown error'}`));
				}
			}
			
			if (process.env.ELECTRIC_METERNUM) {
				if (results.electric.success) {
					console.log(chalk.green(`Electric: âœ… Success (${results.electric.data_points} records)`));
				} else {
					console.log(chalk.red(`Electric: âŒ Failed - ${results.electric.error?.message || 'Unknown error'}`));
				}
			}
			
			// Exit with appropriate code
			const anySuccess = results.gas.success || results.electric.success;
			if (!anySuccess) {
				console.log(chalk.red("âŒ All data collection attempts failed"));
				process.exit(1);
			}
			
		} catch (error) {
			console.error(chalk.red("âŒ Critical error in fetch_once:"), error);
			process.exit(1);
		} finally {
			if (this.browser) {
				console.log(chalk.blue("Closing browser..."));
				await this.browser.close();
			}
			
			const end_time = new Date();
			const duration = end_time.getTime() - start_time.getTime();
			console.log(chalk.green(`=== Completed at ${end_time.toISOString()} (took ${Math.round(duration/1000)}s) ===`));
			
			process.exit(0);
		}
	}

	// Remove the monitor method since we're running daily
	// monitor method removed for scheduled execution
}

