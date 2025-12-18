const express = require('express')
const cors = require('cors');
require('dotenv').config()
const app = express()
const port = process.env.PORT || 3000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')

//middleware
app.use(express.json())
app.use(cors())


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rpcowue.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db('read_On_Route_db');
        const UserCollection = db.collection('users');
        const BooksCollection = db.collection('AllBooks');
        const OrdersCollection = db.collection('orders')


        //orders api
        app.post('/orders',async(req,res)=>{
            const order = req.body;
            const result = await OrdersCollection.insertOne(order);
            res.send(result)
        })

        app.get('/orders',async(req,res)=>{
            const cursor = OrdersCollection.find();
            const result = await cursor.toArray();
            res.send(result)
        })



        app.get('/orders', async (req, res) => {
            const query = {}
            const { email} = req.query;

            if (email) {
                query.email = email;
            }

            const options = { sort: { createdAt: -1 } }

            const cursor = OrdersCollection.find(query, options);
            const result = await cursor.toArray();
            res.send(result);
        })




        //books api
        app.get('/AllBooks', async (req, res) => {
            const cursor = BooksCollection.find()
            const result = await cursor.toArray();
            res.send(result)

        })


        app.get('/AllBooks/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await BooksCollection.findOne(query);
            res.send(result);
        })



        //users api
        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = 'user';
            user.createdAt = new Date();
            const email = user.email;
            const userExists = await UserCollection.findOne({ email })


            if (userExists) {
                return res.send({ message: 'user already exists' })
            }
            const result = await UserCollection.insertOne(user);
            res.send(result)
        })


        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        //await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('reader reading reading...')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
