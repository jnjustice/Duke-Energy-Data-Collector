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

		// Latest reading
		const latest = historical_data[historical_data.length - 1];
		fs.writeFileSync(`../data/${prefix}/duke-${prefix}-latest.json`, JSON.stringify(latest, null, 2));

		// Recent data (last 30 days)
		const thirty_days_ago = new Date();
		thirty_days_ago.setDate(thirty_days_ago.getDate() - 30);
		const recent_data = historical_data.filter(record => new Date(record.date) >= thirty_days_ago);
		fs.writeFileSync(`../data/${prefix}/duke-${prefix}-recent.json`, JSON.stringify(recent_data, null, 2));

		// Monthly summaries
		const monthly_summary = this.createMonthlySummary(historical_data, serviceType);
		fs.writeFileSync(`../data/${prefix}/duke-${prefix}-monthly.json`, JSON.stringify(monthly_summary, null, 2));

		// Energy stats
		const energy_stats = historical_data.map(record => {
			if (serviceType === 'GAS') {
				return {
					date: record.date,
					ccf: record.usage_ccf,
					therms: record.usage_therms,
					cost_estimate: parseFloat((record.usage_ccf * 0.5685).toFixed(2))
				};
			} else {
				return {
					date: record.date,
					kwh: record.usage_kwh,
					cost_estimate: parseFloat((record.usage_kwh * 0.0929).toFixed(2))
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
			headless: true,
			defaultViewport: { width: 1920, height: 1080 },
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		});
		console.log(chalk.green("Browser initialized successfully!"));
	}

	async login(): Promise<void> {
		console.log(chalk.blue("Starting Auth0 login process..."));
		const page = await this.browser!.newPage();
		await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
		
		try {
			// ============================================================
			// STEP 1: Navigate to Duke Energy homepage and click Sign In button
			// ============================================================
			console.log(chalk.blue("Step 1: Navigating to Duke Energy homepage..."));
			await page.goto("https://www.duke-energy.com/home", { 
				waitUntil: 'domcontentloaded',
				timeout: 60000 
			});
			
			await sleep(2000);
			console.log(chalk.green(`Loaded homepage: ${page.url()}`));
			
			// ============================================================
			// STEP 2: Click "Sign in / Register" button
			// ============================================================
			console.log(chalk.blue("Step 2: Clicking 'Sign in / Register' button..."));
			
			// Try multiple selectors for the sign in button
			const signInSelectors = [
				'a[href*="sign-in"]',
				'a:has-text("Sign in")',
				'button:has-text("Sign in")',
				'a:has-text("Register")',
				'.signin-link',
				'[data-testid="sign-in"]'
			];
			
			let signInButton = null;
			
			// First try CSS selectors
			for (const selector of signInSelectors) {
				try {
					await page.waitForSelector(selector, { timeout: 3000 });
					signInButton = selector;
					console.log(chalk.green(`Found sign-in button: ${selector}`));
					break;
				} catch (e) {
					// Try next
				}
			}
			
			// If CSS didn't work, try finding by text content
			if (!signInButton) {
				console.log(chalk.yellow("Trying to find Sign in button by text..."));
				const buttonFound = await page.evaluate(() => {
					const elements = Array.from(document.querySelectorAll('a, button'));
					const signInElement = elements.find(el => {
						const text = el.textContent?.toLowerCase() || '';
						return text.includes('sign in') || text.includes('register');
					});
					
					if (signInElement) {
						// Add a data attribute so we can find it later
						(signInElement as HTMLElement).setAttribute('data-found-signin', 'true');
						return true;
					}
					return false;
				});
				
				if (buttonFound) {
					signInButton = '[data-found-signin="true"]';
					console.log(chalk.green("Found sign-in button by text content"));
				}
			}
			
			if (!signInButton) {
				throw new Error("Could not find Sign in / Register button");
			}
			
			// Click the sign-in button
			console.log(chalk.blue("Clicking sign-in button..."));
			
			const navigationPromise = page.waitForNavigation({ 
				timeout: 30000, 
				waitUntil: 'domcontentloaded' 
			}).catch(e => {
				console.log(chalk.yellow("Navigation wait timed out, checking current URL..."));
				return null;
			});
			
			await page.evaluate((selector) => {
				const element = document.querySelector(selector);
				if (element) {
					element.click();
				}
			}, signInButton);
			
			console.log(chalk.yellow("Waiting for redirect to login.duke-energy.com..."));
			await navigationPromise;
			await sleep(2000);
			
			const currentUrl = page.url();
			console.log(chalk.green(`Current URL after click: ${currentUrl}`));
			
			if (!currentUrl.includes('login.duke-energy.com')) {
				console.log(chalk.yellow("Attempting to wait longer for redirect..."));
				await sleep(5000);
				const finalUrl = page.url();
				console.log(chalk.green(`URL after additional wait: ${finalUrl}`));
				if (!finalUrl.includes('login.duke-energy.com')) {
					throw new Error("Failed to navigate to Auth0 login page");
				}
			}
			
			// ============================================================
			// STEP 3: Enter email/username
			// ============================================================
			console.log(chalk.blue("Step 3: Waiting for Auth0 login form to appear..."));
			
			const emailSelectors = [
				'input[type="email"]',
				'input[name="username"]',
				'input[name="email"]',
				'input[id="username"]',
				'input[id="email"]',
				'input[placeholder*="email" i]',
				'input[placeholder*="username" i]'
			];
			
			let emailInput = null;
			console.log(chalk.yellow("Searching for email input field (may take up to 30s)..."));
			
			for (const selector of emailSelectors) {
				try {
					await page.waitForSelector(selector, { timeout: 30000 });
					emailInput = selector;
					console.log(chalk.green(`Found email field: ${selector}`));
					break;
				} catch (e) {
					// Try next
				}
			}
			
			if (!emailInput) {
				throw new Error("Could not find email/username input field");
			}
			
			console.log(chalk.blue("Entering email address..."));
			await page.type(emailInput, process.env.EMAIL!, { delay: 50 });
			await sleep(500);
			
			// ============================================================
			// STEP 4: Click Continue to get to password page
			// ============================================================
			console.log(chalk.blue("Step 4: Looking for Continue/Next button..."));
			
			const continueSelectors = [
				'button[type="submit"]',
				'input[type="submit"]',
				'button[name="action"]',
				'button:has-text("Continue")',
				'button:has-text("Next")'
			];
			
			let continueButton = null;
			for (const selector of continueSelectors) {
				try {
					await page.waitForSelector(selector, { timeout: 2000 });
					continueButton = selector;
					console.log(chalk.green(`Found continue button: ${selector}`));
					break;
				} catch (e) {
					// Try next
				}
			}
			
			if (!continueButton) {
				const buttonFound = await page.evaluate(() => {
					const buttons = Array.from(document.querySelectorAll('button'));
					const btn = buttons.find(b => {
						const text = b.textContent?.toLowerCase() || '';
						return text.includes('continue') || text.includes('next') || b.type === 'submit';
					});
					if (btn) {
						btn.setAttribute('data-found-continue', 'true');
						return true;
					}
					return false;
				});
				
				if (buttonFound) {
					continueButton = '[data-found-continue="true"]';
					console.log(chalk.green("Found continue button by text"));
				}
			}
			
			if (!continueButton) {
				throw new Error("Could not find Continue/Next button");
			}
			
			console.log(chalk.blue("Clicking Continue button..."));
			
			const continueNavigationPromise = page.waitForNavigation({ 
				timeout: 30000, 
				waitUntil: 'domcontentloaded' 
			}).catch(e => {
				console.log(chalk.yellow("Navigation wait timed out for Continue, checking URL..."));
				return null;
			});
			
			await page.evaluate((selector) => {
				const element = document.querySelector(selector);
				if (element) {
					element.click();
				}
			}, continueButton);
			
			await continueNavigationPromise;
			await sleep(2000);
			console.log(chalk.green(`After Continue: ${page.url()}`));
			
			// ============================================================
			// STEP 5: Enter password
			// ============================================================
			console.log(chalk.blue("Step 5: Looking for password field..."));
			
			const passwordSelectors = [
				'input[type="password"]',
				'input[name="password"]',
				'input[id="password"]'
			];
			
			let passwordInput = null;
			for (const selector of passwordSelectors) {
				try {
					await page.waitForSelector(selector, { timeout: 5000 });
					passwordInput = selector;
					console.log(chalk.green(`Found password field: ${selector}`));
					break;
				} catch (e) {
					// Try next
				}
			}
			
			if (!passwordInput) {
				throw new Error("Could not find password input field");
			}
			
			console.log(chalk.blue("Entering password..."));
			await page.type(passwordInput, process.env.PASSWORD!, { delay: 50 });
			await sleep(500);
			
			// ============================================================
			// STEP 6: Submit login form
			// ============================================================
			console.log(chalk.blue("Step 6: Looking for login submit button..."));
			
			const submitSelectors = [
				'button[type="submit"]',
				'input[type="submit"]',
				'button[name="action"]',
				'button:has-text("Log In")',
				'button:has-text("Sign In")',
				'button:has-text("Continue")'
			];
			
			let submitButton = null;
			for (const selector of submitSelectors) {
				try {
					await page.waitForSelector(selector, { timeout: 2000 });
					submitButton = selector;
					console.log(chalk.green(`Found submit button: ${selector}`));
					break;
				} catch (e) {
					// Try next
				}
			}
			
			if (!submitButton) {
				const buttonFound = await page.evaluate(() => {
					const buttons = Array.from(document.querySelectorAll('button'));
					const btn = buttons.find(b => {
						const text = b.textContent?.toLowerCase() || '';
						return text.includes('log in') || text.includes('sign in') || 
						       text.includes('continue') || b.type === 'submit';
					});
					if (btn) {
						btn.setAttribute('data-found-submit', 'true');
						return true;
					}
					return false;
				});
				
				if (buttonFound) {
					submitButton = '[data-found-submit="true"]';
					console.log(chalk.green("Found submit button by text"));
				}
			}
			
			if (!submitButton) {
				throw new Error("Could not find submit button");
			}
			
			console.log(chalk.blue("Submitting login form..."));
			
			const submitNavigationPromise = page.waitForNavigation({ 
				timeout: 60000, 
				waitUntil: 'domcontentloaded' 
			}).catch(e => {
				console.log(chalk.yellow("Navigation wait timed out for submit, checking URL..."));
				return null;
			});
			
			await page.evaluate((selector) => {
				const element = document.querySelector(selector);
				if (element) {
					element.click();
				}
			}, submitButton);
			
			await submitNavigationPromise;
			await sleep(3000);
			
			const finalUrl = page.url();
			console.log(chalk.green(`Login completed! Current URL: ${finalUrl}`));
			
			if (finalUrl.includes('duke-energy.com') && !finalUrl.includes('login')) {
				console.log(chalk.green("✅ Successfully logged in to Duke Energy!"));
			} else {
				console.log(chalk.yellow(`⚠️  Login may have failed. Current URL: ${finalUrl}`));
				throw new Error("Login verification failed - unexpected URL");
			}
			
		} catch (error) {
			console.error(chalk.red("Login failed:"), error);
			throw error;
		}
	}

	async read_gas_api(): Promise<any> {
		console.log(chalk.blue("Starting GAS API data retrieval..."));
		
		const api_url = "https://p-auth.duke-energy.com/form/PlanRate/GetEnergyUsage";
		
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		
		const thirtyDaysAgo = new Date(yesterday);
		thirtyDaysAgo.setDate(yesterday.getDate() - 30);
		
		const formatDate = (date: Date) => {
			const month = (date.getMonth() + 1).toString().padStart(2, '0');
			const day = date.getDate().toString().padStart(2, '0');
			const year = date.getFullYear();
			return `${month}/${day}/${year}`;
		};
		
		const start_date = formatDate(thirtyDaysAgo);
		const end_date = formatDate(yesterday);
		
		console.log(chalk.blue(`Fetching gas data from ${start_date} to ${end_date}`));
		
		const requestData = {
			SrcAcctId: process.env.ACCOUNTNUM,
			SrcAcctId2: "",
			SrcSysCd: "ISU",
			MeterSerialNumber: process.env.GAS_METERNUM,
			IntervalFrequency: "dailyEnergy",
			Netmetering: "N",
			PeriodType: "Week",
			ServiceType: "GAS",
			StartDate: start_date,
			EndDate: end_date,
			Date: "",
			AgrmtStartDt: "",
			AgrmtEndDt: "",
			MeterCertDt: ""
		};
		
		const payload = {
			request: JSON.stringify(requestData)
		};
		
		console.log(chalk.blue("Sending request to gas API..."));
		
		const response = await this.makeApiRequest(api_url, payload);
		
		console.log(chalk.green("Received gas API response"));
		
		const processed_data = this.processGasData(response);
		
		if (processed_data.length > 0) {
			this.storeUsageData(processed_data, 'GAS');
			this.exportForHomeAssistant('GAS');
		}
		
		return processed_data;
	}

	async read_electric_api(): Promise<any> {
		console.log(chalk.blue("Starting ELECTRIC API data retrieval..."));
		
		const api_url = "https://p-auth.duke-energy.com/form/PlanRate/GetEnergyUsage";
		
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		
		const thirtyDaysAgo = new Date(yesterday);
		thirtyDaysAgo.setDate(yesterday.getDate() - 30);
		
		const formatDate = (date: Date) => {
			const month = (date.getMonth() + 1).toString().padStart(2, '0');
			const day = date.getDate().toString().padStart(2, '0');
			const year = date.getFullYear();
			return `${month}/${day}/${year}`;
		};
		
		const start_date = formatDate(thirtyDaysAgo);
		const end_date = formatDate(yesterday);
		
		console.log(chalk.blue(`Fetching electric data from ${start_date} to ${end_date}`));
		
		const requestData = {
			SrcAcctId: process.env.ACCOUNTNUM,
			SrcAcctId2: "",
			SrcSysCd: "ISU",
			MeterSerialNumber: process.env.ELECTRIC_METERNUM,
			IntervalFrequency: "dailyEnergy",
			Netmetering: "N",
			PeriodType: "Week",
			ServiceType: "ELECTRIC",
			StartDate: start_date,
			EndDate: end_date,
			Date: "",
			AgrmtStartDt: "",
			AgrmtEndDt: "",
			MeterCertDt: ""
		};
		
		const payload = {
			request: JSON.stringify(requestData)
		};
		
		console.log(chalk.blue("Sending request to electric API..."));
		
		const response = await this.makeApiRequest(api_url, payload);
		
		console.log(chalk.green("Received electric API response"));
		
		const processed_data = this.processElectricData(response);
		
		if (processed_data.length > 0) {
			this.storeUsageData(processed_data, 'ELECTRIC');
			this.exportForHomeAssistant('ELECTRIC');
		}
		
		return processed_data;
	}

	// FIX: Navigate to authenticated page first, THEN make the fetch request
	async makeApiRequest(url: string, payload: any): Promise<any> {
		console.log(chalk.blue("Making API request from browser context..."));
		
		try {
			// Create a new page that will inherit cookies from the browser
			const apiPage = await this.browser!.newPage();
			
			// CRITICAL FIX: Navigate to the authenticated Duke Energy domain FIRST
			// This ensures the page has the session cookies loaded before we make the fetch
			console.log(chalk.yellow("Navigating to authenticated domain to load session cookies..."));
			await apiPage.goto('https://p-auth.duke-energy.com/my-account/energy-usage', { 
				waitUntil: 'domcontentloaded',
				timeout: 30000 
			});
			
			await sleep(1000); // Give it a moment to settle
			
			// Now that we're on the authenticated domain with cookies, make the API request
			console.log(chalk.blue("Making fetch request with session cookies..."));
			const result = await apiPage.evaluate(async (apiUrl, data) => {
				try {
					const response = await fetch(apiUrl, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'Accept': 'application/json, text/plain, */*'
						},
						credentials: 'include', // This will now include the cookies from the current domain
						body: JSON.stringify(data)
					});
					
					if (!response.ok) {
						const text = await response.text();
						return {
							error: true,
							status: response.status,
							statusText: response.statusText,
							body: text
						};
					}
					
					const responseJson = await response.json();
					return {
						error: false,
						data: responseJson
					};
				} catch (e: any) {
					return {
						error: true,
						message: e.message,
						stack: e.stack
					};
				}
			}, url, payload);
			
			// Close the API page
			await apiPage.close();
			
			if (result.error) {
				console.error(chalk.red("API Error Details:"), {
					status: result.status,
					statusText: result.statusText,
					message: result.message,
					body: result.body?.substring(0, 200)
				});
				throw new Error(`API request failed: ${result.statusText || result.message} (Status: ${result.status || 'unknown'})`);
			}
			
			console.log(chalk.green("API request successful"));
			return result.data;
			
		} catch (error) {
			console.error(chalk.red("API request failed:"), error);
			throw error;
		}
	}

	processElectricData(raw_data: any): any[] {
		try {
			if (!raw_data.Series1 || !raw_data.TickSeries) {
				console.log(chalk.yellow("No electric usage data found in response"));
				return [];
			}

			const usage_values = raw_data.Series1;
			const date_labels = raw_data.TickSeries;
			
			const processed_data = [];
			const current_year = new Date().getFullYear();
			
			for (let i = 0; i < usage_values.length; i++) {
				const usage = parseFloat(usage_values[i]);
				const date_label = date_labels[i];
				
				// Skip zero values (missing data)
				if (usage === 0.0) {
					console.log(chalk.yellow(`Skipping zero value for ${date_label}`));
					continue;
				}
				
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
				
				// Skip zero values (missing data)
				if (usage === 0.0) {
					console.log(chalk.yellow(`Skipping zero value for ${date_label}`));
					continue;
				}
				
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
			
			if (process.env.GAS_METERNUM) {
				try {
					console.log(chalk.blue("--- Fetching Gas Data ---"));
					const gas_data = await this.read_gas_api();
					results.gas.success = true;
					results.gas.data_points = gas_data.length;
					console.log(chalk.green(`✅ Gas data collection completed: ${gas_data.length} records`));
				} catch (error) {
					results.gas.error = error;
					console.error(chalk.red("❌ Failed to fetch gas data:"), error);
				}
			} else {
				console.log(chalk.yellow("⭐️ Gas meter not configured, skipping gas data collection"));
			}
			
			if (process.env.ELECTRIC_METERNUM) {
				try {
					console.log(chalk.blue("--- Fetching Electric Data ---"));
					const electric_data = await this.read_electric_api();
					results.electric.success = true;
					results.electric.data_points = electric_data.length;
					console.log(chalk.green(`✅ Electric data collection completed: ${electric_data.length} records`));
				} catch (error) {
					results.electric.error = error;
					console.error(chalk.red("❌ Failed to fetch electric data:"), error);
				}
			} else {
				console.log(chalk.yellow("⭐️ Electric meter not configured, skipping electric data collection"));
			}
			
			console.log(chalk.blue("=== Collection Summary ==="));
			if (process.env.GAS_METERNUM) {
				if (results.gas.success) {
					console.log(chalk.green(`Gas: ✅ Success (${results.gas.data_points} records)`));
				} else {
					console.log(chalk.red(`Gas: ❌ Failed - ${results.gas.error?.message || 'Unknown error'}`));
				}
			}
			
			if (process.env.ELECTRIC_METERNUM) {
				if (results.electric.success) {
					console.log(chalk.green(`Electric: ✅ Success (${results.electric.data_points} records)`));
				} else {
					console.log(chalk.red(`Electric: ❌ Failed - ${results.electric.error?.message || 'Unknown error'}`));
				}
			}
			
			const anySuccess = results.gas.success || results.electric.success;
			if (!anySuccess) {
				console.log(chalk.red("❌ All data collection attempts failed"));
				process.exit(1);
			}
			
		} catch (error) {
			console.error(chalk.red("❌ Critical error in fetch_once:"), error);
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
}
