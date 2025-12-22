const express = require('express')
const cors = require('cors');
require('dotenv').config()
const app = express()
const port = process.env.PORT || 3000
const crypto = require("crypto");

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const stripe = require('stripe')(process.env.STRIPE_SECRET)

const admin = require("firebase-admin");

// const serviceAccount = require("./read-on-route-firebase-adminsdk.json");



const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


function generateTrackingId() {
    const prefix = "PRCL"; // your brand prefix
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
    const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex

    return `${prefix}-${date}-${random}`;
}







//middleware
app.use(express.json())
app.use(cors())


const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        //console.log('decoded in the token', decoded);
        req.decoded_email = decoded.email;
        next();
    }
    catch (err) {
        return res.status(401).send({ message: 'unauthorized access' })
    }


}

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
        // await client.connect();

        const db = client.db('read_On_Route_db');
        const UserCollection = db.collection('users');
        const BooksCollection = db.collection('AllBooks');
        const OrdersCollection = db.collection('orders');
        const PaymentCollection = db.collection('payments');
        const wishCollection = db.collection('wish')



        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await UserCollection.findOne(query);

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' });
            }

            next();
        }



        //wish api 

        app.post('/wishList', async (req, res) => {
            const wish = req.body;
            const result = await wishCollection.insertOne(wish);
            res.send(result)
        })


        app.get('/myWishList/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const result = await wishCollection.find(query).toArray();
            res.send(result)

        })


        //payment related apis
        app.post('/create-checkout-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.price) * 100;
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {

                        price_data: {
                            currency: 'BDT',
                            unit_amount: amount,
                            product_data: {
                                name: paymentInfo.name
                            }
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                customer_email: paymentInfo.email,
                metadata: {
                    orderId: paymentInfo.orderId,
                    orderName: paymentInfo.name
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            })

            res.send({ url: session.url })
        })



        app.patch('/payment-success', verifyFBToken, async (req, res) => {
            try {
                const sessionId = req.query.session_id;
                const session = await stripe.checkout.sessions.retrieve(sessionId);
                //console.log(session)

                const transactionId = session.payment_intent;
                const query = { transactionId: transactionId }

                const paymentExist = await PaymentCollection.findOne(query);
                console.log(paymentExist);
                if (paymentExist) {

                    return res.send({
                        message: 'already exists',
                        transactionId,
                        trackingId: paymentExist.trackingId
                    })
                }



                if (session.payment_status === 'paid') {
                    const id = session.metadata.orderId;
                    const query = { _id: new ObjectId(id) }
                    const order = await OrdersCollection.findOne(query);
                    const update = {
                        $set: {
                            paymentStatus: 'paid',
                            trackingId: order.trackingId

                        }
                    }

                    const result = await OrdersCollection.updateOne(query, update);


                    const payment = {
                        amount: session.amount_total / 100,
                        currency: session.currency,
                        customerEmail: session.customer_email,
                        orderId: session.metadata.orderId,
                        orderName: session.metadata.orderName,
                        transactionId: session.payment_intent,
                        paymentStatus: session.payment_status,
                        paidAt: new Date(),
                    }



                    const resultPayment = await PaymentCollection.insertOne(payment)
                    res.send({
                        success: true,
                        modifyOrder: result,
                        trackingId: order?.trackingId,
                        paymentInfo: resultPayment
                    })



                }
                res.send({ success: false })
            }
            catch (error) {
                console.log(error)
            }

        })

        app.get('/payments', verifyFBToken, async (req, res) => {
            const email = req.query.customerEmail;
            const query = {}


            if (email) {
                query.customerEmail = email;

                if (email !== req.decoded_email) {
                    return res.status(403).send({ message: 'forbidden access' })
                }
            }
            const cursor = PaymentCollection.find(query).sort({ paidAt: -1 });
            const result = await cursor.toArray();
            res.send(result);
        })


        //orders api
        app.post('/orders', async (req, res) => {
            const order = req.body;
            const trackingId = generateTrackingId();
            order.trackingId = trackingId;
            const result = await OrdersCollection.insertOne(order);
            res.send(result)
        })


        app.patch('/orders/:id', async (req, res) => {
            const id = req.params.id;
            const { orderStatus } = req.body;
            const query = { _id: new ObjectId(id) }
            const update = {
                $set: {
                    orderStatus: orderStatus
                }
            }
            const result = await OrdersCollection.updateOne(query, update)
            res.send(result)
        })

        app.get('/orders', verifyFBToken, async (req, res) => {
            const email = req.query.email;

            if (email !== req.decoded_email) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            const query = { email };
            const options = { sort: { orderedAt: -1 } };

            const result = await OrdersCollection.find(query, options).toArray();
            res.send(result);
        });

        app.get('/orders/:librarianEmail/status', async (req, res) => {
            const librarianEmail = req.params.librarianEmail;

            const query = { librarianEmail };
            const orders = await OrdersCollection.find(query).toArray();

            res.send(orders);
        });




        app.get('/orders/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await OrdersCollection.findOne(query);
            res.send(result);
        })




        //books api

        app.patch('/AllBooks/:id', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const user = await UserCollection.findOne({ email });

            if (!user || (user.role !== 'admin' && user.role !== 'librarian')) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            const id = req.params.id;
            const updatedBook = req.body;
            const query = { _id: new ObjectId(id) }
            const update = { $set: updatedBook }

            const result = await BooksCollection.updateOne(query, update);
            res.send(result);
        });




        app.get('/AllBooks', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;

            const user = await UserCollection.findOne({ email });

            if (!user) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            let query = {};
            const options = { sort: { createdAt: -1 } };

            // Librarian → only their books
            if (user.role === 'librarian') {
                query = { librarianEmail: email };
            }

            // Admin → ALL books (query stays empty)
            if (user.role === 'admin') {
                query = {};
            }

            const result = await BooksCollection.find(query, options).toArray();
            res.send(result);
        });


        app.get('/public/books', async (req, res) => {
            try {
                const options = { sort: { createdAt: -1 } };
                const books = await BooksCollection.find({}, options).toArray();
                res.send(books);
            } catch (error) {
                res.status(500).send({ message: 'Failed to load books' });
            }
        });



        app.get('/AllBooks/:id', verifyFBToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await BooksCollection.findOne(query);
            res.send(result);
        })


        app.post('/AllBooks', verifyFBToken, async (req, res) => {
            const email = req.decoded_email;
            const user = await UserCollection.findOne({ email });

            if (!user || (user.role !== 'librarian')) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            const book = req.body;

            const result = await BooksCollection.insertOne(book);
            res.send(result);
        });



        app.delete('/AllBooks/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await BooksCollection.deleteOne(query)
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


        app.get('/users', verifyFBToken, verifyAdmin, async (req, res) => {
            const cursor = UserCollection.find()
            const result = await cursor.toArray()
            res.send(result)
        })


        app.get('/users/:email/role', verifyFBToken, async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await UserCollection.findOne(query);
            res.send({ role: user?.role || 'user' })
        })


        app.patch('/users/role/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const { role } = req.body;
            const query = { _id: new ObjectId(id) }
            const update = {
                $set: {
                    role: role
                }
            }
            const result = await UserCollection.updateOne(query, update)
            res.send(result)
        })


        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
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