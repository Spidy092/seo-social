const { getDb } = require('./index');

async function check() {
    const db = getDb();
    console.log("Checking DB...");
    
    const clients = await db.all("SELECT * FROM clients");
    console.log("Clients:", clients);
    
    const projects = await db.all("SELECT * FROM projects");
    console.log("Projects:", projects);
    
    const tasks = await db.all("SELECT * FROM seo_tasks");
    console.log("Tasks:", tasks);
    
    process.exit(0);
}

check().catch(err => {
    console.error(err);
    process.exit(1);
});
