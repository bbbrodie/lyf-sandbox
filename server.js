const express = require('express');
const Stripe = require('stripe'); // Changed to capital S for dynamic init
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit'); // Added for PDF generation
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
app.post('/send-update', async (req, res) => {
console.log('Received POST to /send-update with body:', req.body);
try {
const {
location,
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
emergencyPhone,
agreeMembership,
parqAnswers,  // Object like {q1: 'no', q2: 'yes', ...}
agreeMedical,
signature,
signDate,
paymentMethodId  // From Stripe.js, if provided
} = req.body;
// Basic validation (expand as needed)
if (!location || !firstName || !lastName || !dob || !phone || !email || !agreeMembership || !agreeMedical || !signature || !signDate) {
    return res.status(400).json({ error: 'Missing required details' });
}
const normalizedLocation = location.toLowerCase().replace(/-/g, '');
const keys = locationKeyMap[normalizedLocation];
if (!keys || !keys.secret) {
return res.status(400).json({ error: 'Invalid location' });
}
//static location because its fucked
const locationFormats = {
  'northsydney': 'North Sydney',
  'figtree': 'Figtree',
  'sevenhills': 'Seven Hills',
  'kogarah': 'Kogarah'
};
const formattedLocation = locationFormats[normalizedLocation] || normalizedLocation.charAt(0).toUpperCase() + normalizedLocation.slice(1);

//end location bit
const stripe = Stripe(keys.secret);
let customerId = null;
let stripeUpdateMessage = 'No payment update attempted.';
if (paymentMethodId || true) {  // Always try to update customer details if possible
// Search for customer by email
const customers = await stripe.customers.search({
query: `email:"${email}"`,
});
if (customers.data.length > 0) {
customerId = customers.data[0].id;
// Update customer details (name, address, phone)
await stripe.customers.update(customerId, {
name: `${firstName} ${lastName}`,
phone: phone,
address: {
line1: address,
city: city,
state: state,
postal_code: postcode,
country: 'AU'  // Assuming Australia
}
});
if (paymentMethodId) {
// Attach new payment method and set as default
await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
await stripe.customers.update(customerId, {
invoice_settings: { default_payment_method: paymentMethodId }
});
stripeUpdateMessage = 'Payment method updated successfully.';
} else {
stripeUpdateMessage = 'Customer details updated (no new payment method provided).';
}
} else if (paymentMethodId) {
// If no customer found but payment provided, create new
const customer = await stripe.customers.create({
name: `${firstName} ${lastName}`,
email: email,
phone: phone,
address: {
line1: address,
city: city,
state: state,
postal_code: postcode,
country: 'AU'
}
});
customerId = customer.id;
await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
await stripe.customers.update(customerId, {
invoice_settings: { default_payment_method: paymentMethodId }
});
stripeUpdateMessage = 'New customer created and payment method attached.';
} else {
stripeUpdateMessage = 'No matching customer found; details will be emailed for manual update.';
}
}
// Generate PDF buffer
const pdfBuffer = await generatePDF({
firstName, lastName, dob, phone, email, address, state, city, postcode,
emergencyFirst, emergencyLast, emergencyPhone, parqAnswers, signature, signDate,
agreeMembership, agreeMedical, location: normalizedLocation, customerId, stripeUpdateMessage
});
// Email setup (similar to /send-details-email)
const locationEmails = {
'northsydney': 'northsydney@lyf247.com.au',
'figtree': 'figtree@lyf247.com.au',
'sevenhills': 'sevenhills@lyf247.com.au',
'kogarah': 'kogarah@lyf247.com.au'
};
const toEmail = locationEmails[normalizedLocation] || 'brodie@lyf247.com.au';
const transporter = nodemailer.createTransport({
host: process.env.SMTP_HOST,
port: parseInt(process.env.SMTP_PORT || '587'),
secure: process.env.SMTP_PORT === '465',
auth: {
user: process.env.SMTP_USER,
pass: process.env.SMTP_PASS
}
});
// Format PAR-Q answers
const parqText = Object.entries(parqAnswers || {}).map(([q, ans]) => `Q${q.slice(1)}: ${ans.toUpperCase()}`).join('\n');
// Build address string
const addressStr = `${address}, ${city}, ${state} ${postcode}`;
const mailOptions = {
from: process.env.EMAIL_FROM || process.env.SMTP_USER,
to: email,  // Send to the member's email
cc: `${toEmail}, brodie@lyf247.com.au`,  // CC location and admin
subject: `Lyf 24/7 ${formattedLocation}`,
text: `Hi ${firstName},

Thank you for updating your details with Lyf 24/7 ${formattedLocation}.

We've attached a copy for your records :)

Lyf 24/7`,
attachments: [
{
filename: 'membership-update-summary.pdf',
content: pdfBuffer,
contentType: 'application/pdf'
}
]
};
await transporter.sendMail(mailOptions);
console.log(`Update email sent to ${email} (CC: ${toEmail}, brodie@lyf247.com.au)`);
res.status(200).json({ success: true });
} catch (error) {
console.error('Error in /send-update:', error);
res.status(500).json({ error: 'Failed to process update: ' + error.message });
}
});
// PDF Fuckery

async function generatePDF(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // Add logo if available
    try {
      doc.image('public/logo1.png', 50, 45, { width: 100, align: 'left' });
    } catch (err) {
      console.error('Logo not found or error loading:', err);
    }

    // Header
    doc.fontSize(20).text('Lyf 24/7 Membership Update Summary', 50, 80, { align: 'center', underline: true });
    doc.fontSize(12).text(`Location: ${data.location.toUpperCase()}`, { align: 'center' });
    doc.text(`Date: ${data.signDate}`, { align: 'center' });
    doc.moveDown(2);

    // Personal Information section
    doc.fontSize(14).font('Helvetica-Bold').text('Personal Information');
    doc.font('Helvetica').fontSize(12);
    doc.text(`Name: ${data.firstName} ${data.lastName}`);
    doc.text(`Date of Birth: ${data.dob}`);
    doc.text(`Phone: ${data.phone}`);
    doc.text(`Email: ${data.email}`);
    doc.text(`Address: ${data.address || 'N/A'}, ${data.city || 'N/A'}, ${data.state || 'N/A'} ${data.postcode || 'N/A'}`);
    doc.moveDown();

    // Emergency Contact section
    doc.fontSize(14).font('Helvetica-Bold').text('Emergency Contact');
    doc.font('Helvetica').fontSize(12);
    doc.text(`Name: ${data.emergencyFirst || 'N/A'} ${data.emergencyLast || ''}`);
    doc.text(`Phone: ${data.emergencyPhone || 'N/A'}`);
    doc.moveDown();

    // Membership Agreement section (full text)
    doc.fontSize(14).font('Helvetica-Bold').text('Membership Agreement');
    doc.font('Helvetica').fontSize(10); // Smaller font for long text
    doc.text(`Agreed: Yes`);
    doc.text('Full Agreement Text:'); // Intro
    doc.moveDown(0.5);
    doc.text('I understand and acknowledge that the exercise programs, personal training sessions, exercising, the use of exercising equipment and physical activity including but not limited to unsupervised use, weightlifting, walking, boxing, running and use of various conditioning and exercise equipment involves the risk of injury. I understand and accept the risks of injury, including heart attacks, muscle strains, pulls or tears, broken bones, shin splints, heat prostration, knee/lower back injuries, back and foot injuries, repetitive strain injuries and the like which might arise from an exercise program or the use of exercise and/or conditioning equipment and similar facilities.');
    doc.moveDown(0.5);
    doc.text('I have answered all of the questions correctly and to the best of my knowledge. I also understand that this information may be used as a guide only for a Personal Trainer to assess my current health status, and that any assessment does not replace the advice, recommendation or practice of a general medical practitioner. I acknowledge that it is my ultimate responsibility to ensure I am capable of completing any prescribed exercise without harm. If I have any impairment/s or medical condition/s or am requested by a Lyf 24/7 team member, I agree to seek the advice of a general medical practitioner to ensure I am capable of starting and maintaining an exercise program and I will provide the general medical practitioner with all information, including that provided by Lyf 24/7 or my Personal Trainer, relating to the nature of the exercise program, personal training sessions, physical activity or exercise equipment.');
    doc.moveDown(0.5);
    doc.text('You acknowledge and agree that Lyf 24/7 may do any act necessary to comply with, or which it is specifically authorised to do by legislation, including but not limited to, work health and safety legislation. To this end, Lyf 24/7 may be required to:');
    doc.text('a) Undertake a specific risk assessment for the purposes of identifying any hazards and minimising any risks which may arise from you using the Club facilities; and/or');
    doc.text('b) Conduct further orientation sessions with you for the purposes of communicating and informing you of any hazards and any control measures which have been or will be put in place to ensure, so far as is reasonably practical, your health and safety and the health and safety of others.');
    doc.moveDown(0.5);
    doc.text('You acknowledge and agree that while Lyf 24/7 is doing any of these acts, your access to the facilities may be limited or restricted.');
    doc.moveDown(0.5);
    doc.text('Member Acknowledgment:');
    doc.text('PLEASE SIGN BELOW TO ACKNOWLEDGE YOUR ACCEPTANCE OF THE RELEASE AND INDEMNITY PROVISION IN LYF 24/7\'s TERMS AND CONDITIONS.');
    doc.text('BY ACCEPTING THIS AGREEMENT I ACKNOWLEDGE THAT I HAVE READ AND UNDERSTOOD THE LYF 24/7\'s TERMS AND CONDITIONS. BY ACCEPTING THIS AGREEMENT I ALSO AGREE TO ACCEPT THE TERMS OF THIS AGREEMENT IN ITS ENTIRETY AND TO BE BOUND BY THE CONDITIONS FOR THE DURATION OF MY MEMBERSHIP.');
    doc.moveDown(0.5);
    doc.text('This is an ongoing agreement. The agreement will continue until either you or Lyf 24/7 terminate it in the way described in the Lyf 24/7 Terms and Conditions. If an automatic debit arrangement is in place, membership fees will continue to be debited from your credit card or bank account until you notify Lyf 24/7 to cancel this arrangement.');
    doc.text('Your ongoing fortnightly fee will be the same as it was at the time of signing; if you\'re currently paying $37.90 per fortnight, then you will continue paying $37.90 under this agreement.');
    doc.moveDown();

    // Medical Waiver (PAR-Q) section with full questions and answers
    doc.fontSize(14).font('Helvetica-Bold').text('Medical Waiver (PAR-Q)');
    doc.font('Helvetica').fontSize(12);
    doc.text('Agreed to risks: Yes');
    doc.text('Questions and Answers:');
    doc.moveDown(0.5);
    const parqQuestions = [
      "1. Has your doctor ever said that you have a heart condition and that you should only do physical activity recommended by a doctor?",
      "2. Do you feel pain in your chest when you do physical activity?",
      "3. In the past month, have you had chest pain when you were not doing physical activity?",
      "4. Do you lose your balance because of dizziness or do you ever lose consciousness?",
      "5. Do you have a bone or joint problem (for example, back, knee or hip) that could be made worse by a change in your physical activity?",
      "6. Is your doctor currently prescribing drugs (for example, water pills) for your blood pressure or heart condition?",
      "7. Do you know of any other reason why you should not do physical activity?"
    ];
    Object.entries(data.parqAnswers || {}).forEach(([q, ans], index) => {
      doc.text(`${parqQuestions[index - 1]}: ${ans.toUpperCase()}`);
    });
    doc.moveDown();

    // Signature section
    doc.fontSize(14).font('Helvetica-Bold').text('Signature');
    doc.font('Helvetica').fontSize(12);
    doc.text(`${data.signature} on ${data.signDate}`);
    doc.moveDown();

    // Stripe Update section
    doc.fontSize(14).font('Helvetica-Bold').text('Stripe Update');
    doc.font('Helvetica').fontSize(12);
    doc.text(data.stripeUpdateMessage);
    doc.text(`Customer ID: ${data.customerId || 'N/A'}`);

    doc.end();
  });
}
// end PDF fuckery

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
