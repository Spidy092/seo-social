require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./src/db');

async function createAdmin() {
    const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = String(process.env.ADMIN_PASSWORD || '');

    if (!email || !password || password.length < 12) {
        console.error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters before running this script.');
        process.exit(1);
    }

    try {
        await db.initializeDatabase();
        
        // Check if user already exists
        const check = await db.query('SELECT * FROM users WHERE email = $1', [email]);
        if (check.rows.length > 0) {
            console.log(`User ${email} already exists!`);
            process.exit(0);
        }

        const password_hash = await bcrypt.hash(password, 10);
        await db.query(
            'INSERT INTO users (email, password_hash) VALUES ($1, $2)',
            [email, password_hash]
        );
        
        console.log('----------------------------------------');
        console.log('✅ Admin User Successfully Seeded!');
        console.log(`Email:    ${email}`);
        console.log('----------------------------------------');
        process.exit(0);
    } catch (err) {
        console.error('Failed to seed admin user:', err);
        process.exit(1);
    }
}

createAdmin();
