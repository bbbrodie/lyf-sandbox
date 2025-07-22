import stripe

stripe.api_key = 'sk_test_51RTuA98A2e4dDvfp0ger26sl3wLdDLQxrpf93Kxj9mtXh2dUP3mmfLpSB9ImUBCgrFddoWkfcDSXlMe62e1z93ED00YLdSxeER'

PRODUCT_ID = 'prod_ShbAHciCD4OwCq'  # Your existing Product ID

price = stripe.Price.create(
    product=PRODUCT_ID,
    unit_amount=1895,  # $18.95 in cents
    currency='aud',
    recurring={'interval': 'week'}
)

print("Created Price ID:", price.id)  # Copy this (e.g., 'price_xxx')
