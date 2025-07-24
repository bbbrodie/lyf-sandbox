const express = require('express');
const Stripe = require('stripe'); // Changed to capital S for dynamic init
const nodemailer = require('nodemailer');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

console.log('Server initialized with /send-details-email POST endpoint');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Location to key mapping (using your preferred env var codes)
const locationKeyMap = {
  'northsydney': {
    secret: process.env.STRIPE_SECRET_NS,
    pub: process.env.STRIPE_PUB_NS
  },
  'figtree': {
    secret: process.env.STRIPE_SECRET_FT,
    pub: process.env.STRIPE_PUB_FT
  },
  'sevenhills': {
    secret: process.env.STRIPE_SECRET_SH,
    pub: process.env.STRIPE_PUB_SH
  },
  'kogarah': {
    secret: process.env.STRIPE_SECRET_KO,
    pub: process.env.STRIPE_PUB_KO
  }
};

// New endpoint to get publishable key for frontend
app.get('/get-pub-key', (req, res) => {
  const location = req.query.location?.toLowerCase(); // Normalize if needed
  const keys = locationKeyMap[location];
  if (!keys || !keys.pub) {
    return res.status(400).json({ error: 'Invalid or missing location for publishable key' });
  }
  res.json({ publishableKey: keys.pub });
});

app.post('/create-setup-intent', async (req, res) => {
  try {
    const { name, email, address, location } = req.body;

    console.log('Received customer data:', { name, email, address, location });

    if (!location) {
      const errorMsg = 'Missing location';
      console.error(errorMsg);
      return res.status(400).json({ error: errorMsg });
    }

    const normalizedLocation = location.toLowerCase().replace(/-/g, '');
    const keys = locationKeyMap[normalizedLocation];
    if (!keys || !keys.secret) {
      const errorMsg = 'Invalid location for Stripe key';
      console.error(errorMsg);
      return res.status(400).json({ error: errorMsg });
    }

    const stripe = Stripe(keys.secret); // Dynamic init

    if (!name || !email || !address || !address.country) {
      const errorMsg = 'Missing required customer details: name, email, or address';
      console.error(errorMsg);
      return res.status(400).json({ error: errorMsg });
    }

    const customer = await stripe.customers.create({
      name: name,
      email: email,
      address: address
    });

    console.log('Created Stripe customer:', customer);

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['au_becs_debit', 'card']
    });

    res.json({
      clientSecret: setupIntent.client_secret,
      customerId: customer.id
    });
  } catch (error) {
    console.error('Error in /create-setup-intent:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/create-subscription-final', async (req, res) => {
  try {
    const { customerId, setupIntentId, priceId, oneTimePriceId, trialDays, location } = req.body;

    if (!customerId || !setupIntentId || !priceId || !location) {
      return res.status(400).json({ error: 'Missing customerId, setupIntentId, priceId, or location' });
    }

    const normalizedLocation = location.toLowerCase().replace(/-/g, '');
    const keys = locationKeyMap[normalizedLocation];
    if (!keys || !keys.secret) {
      const errorMsg = 'Invalid location for Stripe key';
      console.error(errorMsg);
      return res.status(400).json({ error: errorMsg });
    }

    const stripe = Stripe(keys.secret); // Dynamic init

    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    const paymentMethod = setupIntent.payment_method;

    await stripe.paymentMethods.attach(paymentMethod, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethod }
    });

    const addInvoiceItems = oneTimePriceId ? [{ price: oneTimePriceId }] : [];

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      add_invoice_items: addInvoiceItems,
      trial_period_days: trialDays || 0,
      expand: ['latest_invoice.payment_intent']
    });

    res.json({ subscriptionId: subscription.id });
  } catch (error) {
    console.error('Error in /create-subscription-final:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/send-details-email', async (req, res) => {
  console.log('Received POST to /send-details-email with body:', req.body);
  try {
    const {
      location,
      plan: reqPlan,  // Renamed to avoid conflict
      type,  // Added to handle legacy 'type' from trial forms
      firstName,
      lastName,
      dob,
      phone,
      email,
      address,
      state,
      city,
      postcode,
      emergencyFirst,
      emergencyLast,
      emergencyPhone
    } = req.body;

    const plan = reqPlan || type;  // Use 'plan' if present, fallback to 'type'

    let requiredFieldsMet = false;
    if (plan === 'free-trial') {
      requiredFieldsMet = location && plan && firstName && lastName && phone && email;
    } else {
      requiredFieldsMet = location && plan && firstName && lastName && dob && phone && email && address && state && city && postcode;
    }

    if (!requiredFieldsMet) {
      return res.status(400).json({ error: 'Missing required details' });
    }

    // Normalize location to match mapping keys (e.g., 'seven-hills' -> 'sevenhills')
    const normalizedLocation = location.toLowerCase().replace(/-/g, '');

    const locationEmails = {
      'northsydney': 'northsydney@lyf247.com.au',
      'figtree': 'figtree@lyf247.com.au',
      'sevenhills': 'sevenhills@lyf247.com.au',
      'kogarah': 'kogarah@lyf247.com.au'
    };

    const toEmail = locationEmails[normalizedLocation] || 'brodie@lyf247.com.au';
    console.log(`Selected email: ${toEmail} for normalized location: ${normalizedLocation}`);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    await transporter.verify();
    console.log('SMTP connection verified');

    // Build address string handling optionals
    let addressStr = '';
    if (address) addressStr += address;
    if (city) addressStr += (addressStr ? ', ' : '') + city;
    if (state) addressStr += (addressStr ? ', ' : '') + state;
    if (postcode) addressStr += (addressStr ? ' ' : '') + postcode;

    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: toEmail,
      cc: 'brodie@lyf247.com.au',
      subject: `New ${plan === 'free-trial' ? 'Free Trial' : 'Membership'} Details Submitted at ${normalizedLocation}`,
      text: `A new user has submitted their details for a ${plan} at ${normalizedLocation}.

Personal Information:
- Name: ${firstName} ${lastName}
- Date of Birth: ${dob || 'N/A'}
- Phone: ${phone}
- Email: ${email}
- Address: ${addressStr || 'N/A'}

Emergency Contact:
- Name: ${emergencyFirst || 'N/A'} ${emergencyLast || ''}
- Phone: ${emergencyPhone || 'N/A'}

Note: ${plan === 'free-trial' ? 'This is a free trial signup.' : 'This is before payment processing. The user is being redirected to the payment page.'}`
    };

    await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${toEmail} (CC: brodie@lyf247.com.au) for location ${normalizedLocation}`);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error in /send-details-email:', error);
    res.status(500).json({ error: 'Failed to send email: ' + error.message });
  }
});

app.get('/test-email', async (req, res) => {
  console.log('Test-email endpoint hit');
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: 'brodie@lyf247.com.au',
      subject: 'Test Email',
      text: 'This is a test email from your Render service.'
    });
    res.send('Test email sent successfully');
  } catch (error) {
    console.error('SMTP Test Error:', error);
    res.send('Error sending test email: ' + error.message);
  }
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
