import "dotenv/config";

function pick(v: string | undefined, d: string): string {
if (v === undefined || v === "") return d;
return v;
}

export const env = {
port: Number(pick(process.env.PORT, "3000")),
jwtSecret: pick(process.env.JWT_SECRET, "dev-secret-change-me"),
dbPath: pick(process.env.DB_PATH, "./data/app.db"),
clientOrigin: pick(process.env.CLIENT_ORIGIN, "http://localhost:5173"),
};
