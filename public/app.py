from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import stripe

app = Flask(__name__)
CORS(app)

stripe.api_key = 'sk_test_51RTuA98A2e4dDvfp0ger26sl3wLdDLQxrpf93Kxj9mtXh2dUP3mmfLpSB9ImUBCgrFddoWkfcDSXlMe62e1z93ED00YLdSxeER'

YOUR_DOMAIN = 'https://lyf-test.onrender.com'
PRICE_ID = 'price_1RmCZ38A2e4dDvfpY3fpthB6'

@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory('.', filename)

@app.route('/create-setup-intent', methods=['POST'])
def create_setup_intent():
    data = request.json
    try:
        customer = stripe.Customer.create(
            email=data['email'],
            name=data.get('name')
        )

        setup_intent = stripe.SetupIntent.create(
            customer=customer.id,
            payment_method_types=['au_becs_debit', 'card'],  # Support both
            usage='off_session'
        )

        return jsonify({
            'clientSecret': setup_intent.client_secret,
            'customerId': customer.id
        })
    except Exception as e:
        return jsonify(error=str(e)), 403

@app.route('/create-subscription-final', methods=['POST'])
def create_subscription_final():
    data = request.json
    try:
        customer_id = data['customerId']
        setup_intent_id = data['setupIntentId']

        setup_intent = stripe.SetupIntent.retrieve(setup_intent_id)

        if setup_intent.status != 'succeeded':
            raise ValueError("Setup failed")

        payment_method = setup_intent.payment_method

        stripe.PaymentMethod.attach(
            payment_method,
            customer=customer_id
        )

        stripe.Customer.modify(
            customer_id,
            invoice_settings={'default_payment_method': payment_method}
        )

        subscription = stripe.Subscription.create(
            customer=customer_id,
            items=[{'price': PRICE_ID}],
            payment_behavior='default_incomplete',
            expand=['latest_invoice.payment_intent']
        )

        return jsonify({
            'subscriptionId': subscription.id
        })
    except Exception as e:
        return jsonify(error=str(e)), 403

if __name__ == '__main__':
    app.run(port=4242)
