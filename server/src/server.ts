import fastify from "fastify";
import fs from "fs";
import chalk from "chalk";
import path from "path";

// Configuration
const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIRECTORY = process.env.DATA_DIRECTORY || '../data';

class DukeEnergyServer {
    server: any;

    constructor() {
        this.server = fastify({ 
            logger: {
                level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
            }
        });
        this.setupRoutes();
        this.setupGracefulShutdown();
    }

    setupRoutes(): void {
        // Add CORS headers for all requests
        this.server.addHook('onRequest', async (request: any, reply: any) => {
            reply.headers({
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            });
        });

        // Handle OPTIONS requests (CORS preflight)
        this.server.options('*', async (request: any, reply: any) => {
            return reply.code(200).send();
        });

        // Root endpoint - service information
        this.server.get('/', async (request: any, reply: any) => {
            return {
                service: 'Duke Energy Data Server',
                version: '1.0.0',
                environment: process.env.NODE_ENV || 'development',
                uptime: process.uptime(),
                endpoints: {
                    '/health': 'Server health and file status',
                    '/gas-latest': 'Latest gas reading',
                    '/gas-history': 'Complete gas historical data',
                    '/gas-recent': 'Recent gas data (last 30 days)',
                    '/gas-monthly': 'Gas monthly usage summaries',
                    '/gas-raw': 'Raw gas API response data',
                    '/electric-latest': 'Latest electric reading',
                    '/electric-history': 'Complete electric historical data',
                    '/electric-recent': 'Recent electric data (last 30 days)',
                    '/electric-monthly': 'Electric monthly usage summaries',
                    '/electric-raw': 'Raw electric API response data'
                },
                data_directory: path.resolve(DATA_DIRECTORY)
            };
        });

        // Health check endpoint (required for Docker health checks)
        this.server.get('/health', async (request: any, reply: any) => {
            const files = {
                gas: {
                    latest: this.fileExists('gas/duke-gas-latest.json'),
                    history: this.fileExists('gas/duke-gas-history.json'),
                    recent: this.fileExists('gas/duke-gas-recent.json'),
                    monthly: this.fileExists('gas/duke-gas-monthly.json'),
                    raw: this.fileExists('gas/duke-gas-raw.json')
                },
                electric: {
                    latest: this.fileExists('electric/duke-electric-latest.json'),
                    history: this.fileExists('electric/duke-electric-history.json'),
                    recent: this.fileExists('electric/duke-electric-recent.json'),
                    monthly: this.fileExists('electric/duke-electric-monthly.json'),
                    raw: this.fileExists('electric/duke-electric-raw.json')
                }
            };

            const gasLastUpdated = this.getLastModified('gas/duke-gas-latest.json');
            const electricLastUpdated = this.getLastModified('electric/duke-electric-latest.json');
            
            return {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                data_directory: path.resolve(DATA_DIRECTORY),
                files_available: files,
                last_updated: {
                    gas: gasLastUpdated,
                    electric: electricLastUpdated
                },
                uptime: process.uptime(),
                memory_usage: process.memoryUsage(),
                environment: process.env.NODE_ENV || 'development'
            };
        });

        // Gas data endpoints
        this.server.get('/gas-latest', async (request: any, reply: any) => {
            return this.serveJsonFile('gas/duke-gas-latest.json', reply);
        });

        this.server.get('/gas-history', async (request: any, reply: any) => {
            return this.serveJsonFile('gas/duke-gas-history.json', reply);
        });

        this.server.get('/gas-recent', async (request: any, reply: any) => {
            return this.serveJsonFile('gas/duke-gas-recent.json', reply);
        });

        this.server.get('/gas-monthly', async (request: any, reply: any) => {
            return this.serveJsonFile('gas/duke-gas-monthly.json', reply);
        });

        this.server.get('/gas-raw', async (request: any, reply: any) => {
            return this.serveJsonFile('gas/duke-gas-raw.json', reply);
        });

        // Electric data endpoints
        this.server.get('/electric-latest', async (request: any, reply: any) => {
            return this.serveJsonFile('electric/duke-electric-latest.json', reply);
        });

        this.server.get('/electric-history', async (request: any, reply: any) => {
            return this.serveJsonFile('electric/duke-electric-history.json', reply);
        });

        this.server.get('/electric-recent', async (request: any, reply: any) => {
            return this.serveJsonFile('electric/duke-electric-recent.json', reply);
        });

        this.server.get('/electric-monthly', async (request: any, reply: any) => {
            return this.serveJsonFile('electric/duke-electric-monthly.json', reply);
        });

        this.server.get('/electric-raw', async (request: any, reply: any) => {
            return this.serveJsonFile('electric/duke-electric-raw.json', reply);
        });

        // Generic data endpoint with filtering
        this.server.get('/data/:type/:format?', async (request: any, reply: any) => {
            const { type, format } = request.params;
            const validTypes = ['gas', 'electric'];
            const validFormats = ['latest', 'history', 'recent', 'monthly', 'raw'];
            
            if (!validTypes.includes(type)) {
                return reply.code(400).send({ 
                    error: 'Invalid type. Must be "gas" or "electric"',
                    valid_types: validTypes
                });
            }
            
            const fileFormat = format || 'latest';
            if (!validFormats.includes(fileFormat)) {
                return reply.code(400).send({ 
                    error: 'Invalid format',
                    valid_formats: validFormats
                });
            }
            
            const filename = `${type}/duke-${type}-${fileFormat}.json`;
            return this.serveJsonFile(filename, reply);
        });

        // List all available files
        this.server.get('/files', async (request: any, reply: any) => {
            const availableFiles = this.listAvailableFiles();
            return {
                data_directory: path.resolve(DATA_DIRECTORY),
                total_files: availableFiles.length,
                files: availableFiles.map(file => ({
                    name: file,
                    path: this.getFilePath(file),
                    last_modified: this.getLastModified(file),
                    size: this.getFileSize(file)
                }))
            };
        });
    }

    private getFilePath(filename: string): string {
        return path.join(DATA_DIRECTORY, filename);
    }

    private fileExists(filename: string): boolean {
        try {
            return fs.existsSync(this.getFilePath(filename));
        } catch (error) {
            return false;
        }
    }

    private getLastModified(filename: string): string | null {
        try {
            const stats = fs.statSync(this.getFilePath(filename));
            return stats.mtime.toISOString();
        } catch (error) {
            return null;
        }
    }

    private getFileSize(filename: string): number | null {
        try {
            const stats = fs.statSync(this.getFilePath(filename));
            return stats.size;
        } catch (error) {
            return null;
        }
    }

    private async serveJsonFile(filename: string, reply: any): Promise<any> {
        try {
            if (!this.fileExists(filename)) {
                return reply.code(404).send({ 
                    error: `File ${filename} not found`,
                    available_files: this.listAvailableFiles(),
                    data_directory: path.resolve(DATA_DIRECTORY)
                });
            }

            const data = JSON.parse(fs.readFileSync(this.getFilePath(filename), 'utf8'));
            
            // Add metadata to response headers
            const stats = fs.statSync(this.getFilePath(filename));
            reply.header('Last-Modified', stats.mtime.toUTCString());
            reply.header('Content-Type', 'application/json');
            reply.header('Cache-Control', 'public, max-age=900'); // Cache for 15 minutes
            
            return data;
            
        } catch (error) {
            console.error(chalk.red(`Error serving ${filename}:`), error);
            return reply.code(500).send({ 
                error: `Failed to read ${filename}`,
                details: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    private listAvailableFiles(): string[] {
        const possibleFiles = [
            'gas/duke-gas-latest.json', 
            'gas/duke-gas-history.json', 
            'gas/duke-gas-recent.json', 
            'gas/duke-gas-monthly.json', 
            'gas/duke-gas-raw.json',
            'electric/duke-electric-latest.json', 
            'electric/duke-electric-history.json', 
            'electric/duke-electric-recent.json',
            'electric/duke-electric-monthly.json', 
            'electric/duke-electric-raw.json'
        ];
        return possibleFiles.filter(file => this.fileExists(file));
    }

    private setupGracefulShutdown(): void {
        // Handle graceful shutdown
        const gracefulShutdown = async (signal: string) => {
            console.log(chalk.yellow(`\n🛑 Received ${signal}. Starting graceful shutdown...`));
            try {
                await this.server.close();
                console.log(chalk.green('✅ Server shut down gracefully'));
                process.exit(0);
            } catch (error) {
                console.error(chalk.red('❌ Error during shutdown:'), error);
                process.exit(1);
            }
        };

        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    }

    async start(): Promise<void> {
        try {
            // Ensure data directory exists
            if (!fs.existsSync(DATA_DIRECTORY)) {
                console.log(chalk.yellow(`⚠️  Data directory not found: ${path.resolve(DATA_DIRECTORY)}`));
                console.log(chalk.blue('💡 Waiting for data files to be created by the collector...'));
            }

            await this.server.listen({ port: PORT, host: HOST });
            
            console.log(chalk.green(`🚀 Duke Energy Data Server started successfully!`));
            console.log(chalk.blue(`📡 Server running on: http://${HOST}:${PORT}`));
            console.log(chalk.blue(`📁 Data directory: ${path.resolve(DATA_DIRECTORY)}`));
            console.log(chalk.blue(`🐳 Environment: ${process.env.NODE_ENV || 'development'}`));
            
            // Log available endpoints
            console.log(chalk.yellow('\n📋 Available endpoints:'));
            console.log(chalk.yellow(`   💡 Health check:      http://localhost:${PORT}/health`));
            console.log(chalk.yellow(`   📊 Gas latest:        http://localhost:${PORT}/gas-latest`));
            console.log(chalk.yellow(`   ⚡ Electric latest:   http://localhost:${PORT}/electric-latest`));
            console.log(chalk.yellow(`   📈 All gas data:      http://localhost:${PORT}/gas-history`));
            console.log(chalk.yellow(`   📈 All electric data: http://localhost:${PORT}/electric-history`));
            console.log(chalk.yellow(`   📄 File list:         http://localhost:${PORT}/files`));
            
            // Check for existing files
            const availableFiles = this.listAvailableFiles();
            if (availableFiles.length > 0) {
                console.log(chalk.green(`\n✅ Found ${availableFiles.length} data files:`));
                availableFiles.forEach(file => {
                    const lastMod = this.getLastModified(file);
                    const size = this.getFileSize(file);
                    console.log(chalk.green(`   📄 ${file} (${size} bytes, updated: ${lastMod})`));
                });
            } else {
                console.log(chalk.yellow('\n⚠️  No data files found yet. Waiting for data collection...'));
                console.log(chalk.blue('💡 Run the collector to create data files:'));
                console.log(chalk.blue('   cd ../collector && bun run collect'));
            }
            
        } catch (error) {
            console.error(chalk.red('❌ Failed to start server:'), error);
            process.exit(1);
        }
    }
}

// Start the server
const server = new DukeEnergyServer();
server.start();