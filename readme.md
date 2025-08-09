# Duke Energy Data Collector

Automated data collection from Duke Energy for Home Assistant integration. This project collects your electricity and gas usage data and serves it via a REST API that Home Assistant can consume.

## Features

- 🔄 **Automated Data Collection**: Scheduled collection of Duke Energy usage data
- 📊 **Historical Data**: Tracks daily, monthly, and recent usage patterns
- 🏠 **Home Assistant Integration**: REST API endpoints for seamless HA integration
- 🐳 **Docker Support**: Containerized web server for easy deployment
- ⚡ **Built with Bun**: Fast TypeScript runtime for optimal performance

## Project Structure

```
duke-energy-project/
├── collector/              # Data collection scripts
│   ├── src/
│   │   ├── duke.ts         # Duke Energy API client
│   │   └── index.ts        # Main collection logic
│   ├── run-daily.ps1       # PowerShell wrapper for scheduling
│   └── .env.template       # Environment configuration template
├── server/                 # Docker web server
│   ├── src/server.ts       # REST API server
│   ├── Dockerfile          # Container configuration
│   └── docker-compose.yml  # Docker deployment
├── data/                   # JSON data storage
│   ├── electric/           # Electricity usage data
│   └── gas/                # Gas usage data
└── home-assistant/         # HA configuration examples
    └── configuration.yaml  # Sample HA config
    └── automation.yaml     # Sample HA automation
```

## Prerequisites

- **Windows** (for Task Scheduler automation)
- **[Bun](https://bun.sh/)** - JavaScript runtime and package manager
- **[Docker](https://www.docker.com/)** - For the web server (optional but recommended)
- **Duke Energy Account** - With online access

## Installation

### 1. Install Bun

Download and install Bun from [bun.sh](https://bun.sh/):

```powershell
# Windows (PowerShell)
irm bun.sh/install.ps1 | iex
```

### 2. Clone and Setup Project

```bash
git clone <your-repo-url> duke-energy-project
cd duke-energy-project
```

### 3. Configure Data Collector

```bash
cd collector
bun install

# Copy and configure environment variables
cp .env.template .env
```

Edit `.env` with your Duke Energy credentials:
```bash
DUKE_USERNAME=your-email@example.com
DUKE_PASSWORD=your-password
DUKE_ACCOUNT_NUMBER=your-account-number
```

### 4. Test Data Collection

```bash
# Run a test collection
bun run src/index.ts
```

If successful, you should see data files created in the `../data/` directory.

## Automation Setup

### Windows Task Scheduler

1. **Open Task Scheduler** (`taskschd.msc`)

2. **Create Basic Task**:
   - Name: `Duke Energy Data Collection`
   - Trigger: `Daily` at your preferred time (e.g., 6:00 AM)

3. **Action Configuration**:
   - Action: `Start a program`
   - Program: `powershell.exe`
   - Arguments: `-ExecutionPolicy Bypass -File "C:\path\to\duke-energy-project\collector\run-daily.ps1"`
   - Start in: `C:\path\to\duke-energy-project\collector`

4. **Additional Settings**:
   - ✅ Run whether user is logged on or not
   - ✅ Run with highest privileges
   - ✅ Configure for Windows 10/11

### Alternative: Manual Scheduling

You can also run the PowerShell script manually:

```powershell
cd collector
.\run-daily.ps1
```

## Web Server Deployment

### Option 1: Docker (Recommended)

```bash
cd server

# Build and start the server
docker-compose up -d

# Or build manually
docker build -t duke-energy-server .
docker run -d -p 3001:3000 -v ./data:/app/data duke-energy-server
```

### Option 2: Direct Bun

```bash
cd server
bun install
bun run src/server.ts
```

The server will be available at `http://localhost:3001`

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Server status and available endpoints |
| `GET /electric/latest` | Most recent electricity reading |
| `GET /electric/history` | Historical electricity data |
| `GET /electric/monthly` | Monthly electricity summaries |
| `GET /electric/stats` | Electricity usage statistics |
| `GET /gas/latest` | Most recent gas reading |
| `GET /gas/history` | Historical gas data |
| `GET /gas/monthly` | Monthly gas summaries |
| `GET /gas/stats` | Gas usage statistics |

## Home Assistant Integration

### 1. Add REST Sensors

Add to your `configuration.yaml`:

```yaml
# Electricity Sensors
rest:
  - resource: "http://your-server:3001/electric/latest"
    scan_interval: 3600  # Update every hour
    sensor:
      - name: "Duke Electric Current Usage"
        value_template: "{{ value_json.usage_kwh }}"
        unit_of_measurement: "kWh"
        device_class: energy
      
      - name: "Duke Electric Daily Cost"
        value_template: "{{ value_json.cost_dollars }}"
        unit_of_measurement: "$"

  - resource: "http://your-server:3001/gas/latest"
    scan_interval: 3600
    sensor:
      - name: "Duke Gas Current Usage"
        value_template: "{{ value_json.usage_ccf }}"
        unit_of_measurement: "CCF"
        device_class: gas
      
      - name: "Duke Gas Daily Cost"
        value_template: "{{ value_json.cost_dollars }}"
        unit_of_measurement: "$"
```

### 2. Create Dashboard Cards

```yaml
# Energy Dashboard Card
type: entities
title: Duke Energy Usage
entities:
  - entity: sensor.duke_electric_current_usage
    name: "Electricity Usage"
  - entity: sensor.duke_electric_daily_cost
    name: "Electric Cost Today"
  - entity: sensor.duke_gas_current_usage
    name: "Gas Usage"
  - entity: sensor.duke_gas_daily_cost
    name: "Gas Cost Today"
```

### 3. Create Automation

Go to home-assistant/automation.yaml and set up your daily automation to run after the Windows Task Scheduler fetches new data

### 4. Historical Data Integration

For historical data and trends, use the history endpoints:

```yaml
rest:
  - resource: "http://your-server:3001/electric/stats"
    scan_interval: 86400  # Daily
    sensor:
      - name: "Duke Electric Monthly Average"
        value_template: "{{ value_json.monthly_average_kwh }}"
        unit_of_measurement: "kWh"
```

## Troubleshooting

### Data Collection Issues

1. **Check credentials**: Verify `.env` file has correct Duke Energy login
2. **Test login**: Try logging into Duke Energy website manually
3. **Check logs**: Look at PowerShell execution logs in Task Scheduler
4. **Network issues**: Ensure stable internet connection

### Server Issues

1. **Port conflicts**: Change port in `docker-compose.yml` if 3000 is taken
2. **Data volume**: Ensure Docker has access to the data directory
3. **Firewall**: Check Windows firewall allows connections to port 3000

### Home Assistant Issues

1. **Network access**: Ensure HA can reach your server IP/port
2. **Sensor naming**: Check for conflicts with existing sensor names
3. **JSON format**: Verify API responses match your value templates

## Data Storage

Data is stored in JSON files under the `data/` directory:

- **Raw data**: Complete API responses for debugging
- **Processed data**: Cleaned data for consumption
- **Historical**: Time-series data with timestamps
- **Statistics**: Calculated averages and trends

## Security Notes

- 🔒 Keep your `.env` file secure and never commit it to git
- 🔒 Consider using environment variables instead of files in production
- 🔒 Restrict network access to the web server as needed
- 🔒 Regularly rotate your Duke Energy password

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is for personal use only. Please respect Duke Energy's terms of service.

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review logs in Task Scheduler and Docker
3. Verify your Duke Energy account access
4. Create an issue with detailed error information

---

**⚡ Powered by Bun | 🏠 Home Assistant Ready | 🐳 Docker Optimized**
