-- Insert a test business (replace YOUR_TELEGRAM_ID with your actual Telegram ID)
INSERT INTO businesses (owner_telegram_id, name, category, location, trust_level, onboarding_completed)
VALUES (123456789, 'iConnect', 'Technology / Digital Services', 'Addis Ababa', 1, true);

-- Insert test products
INSERT INTO products (business_id, name, name_am, price, stock_quantity, low_stock_threshold) VALUES
((SELECT id FROM businesses LIMIT 1), 'NFC Business Card', 'NFC የንግድ ካርድ', 500, 100, 10),
((SELECT id FROM businesses LIMIT 1), 'QR Stand', 'QR መቆሚያ', 350, 50, 5),
((SELECT id FROM businesses LIMIT 1), 'Digital Card Package', 'ዲጂታል ካርድ ጥቅል', 1500, 30, 5);
