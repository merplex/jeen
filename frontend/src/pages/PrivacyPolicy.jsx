export default function PrivacyPolicy() {
  return (
    <div className="max-w-lg mx-auto min-h-screen bg-white px-6 py-10 text-gray-700">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
      <p className="text-sm text-gray-400 mb-8">Last updated: March 10, 2026</p>

      <section className="mb-6">
        <p>
          C-T Scan ("we", "our", or "us") operates the C-T Scan mobile application. This page
          informs you of our policies regarding the collection, use, and disclosure of personal
          data when you use our app.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Information We Collect</h2>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Account identifiers you provide (email, phone number, or LINE ID)</li>
          <li>Dictionary search history to provide history features</li>
          <li>Flashcard and learning progress</li>
          <li>
            Camera images (only when you use the OCR feature — processed on-device or sent to our
            server for text recognition, then discarded)
          </li>
          <li>
            Microphone audio (only when you use Speaking Practice — processed for pronunciation
            scoring, then discarded)
          </li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">How We Use Your Information</h2>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>To provide and maintain the app's features</li>
          <li>To save your search history and learning progress</li>
          <li>To process pronunciation assessments</li>
          <li>To manage subscriptions through Google Play or Apple App Store</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Data Retention</h2>
        <p className="text-sm">
          Your data is stored as long as your account is active. You can request deletion of your
          account and all associated data at any time by contacting us.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Third-Party Services</h2>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>Google Play (subscription billing)</li>
          <li>Apple App Store (subscription billing)</li>
          <li>Google Gemini API (AI-powered word suggestions)</li>
          <li>Azure Cognitive Services (pronunciation assessment)</li>
          <li>LINE Login (optional authentication)</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Children's Privacy</h2>
        <p className="text-sm">
          Our app does not knowingly collect personal information from children under 13. If you
          believe your child has provided us with personal information, please contact us.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Security</h2>
        <p className="text-sm">
          We use commercially reasonable measures to protect your information. No method of
          transmission over the internet is 100% secure.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Changes to This Policy</h2>
        <p className="text-sm">
          We may update this Privacy Policy from time to time. We will notify you of any changes
          by updating the date at the top of this page.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Contact Us</h2>
        <p className="text-sm">
          If you have any questions about this Privacy Policy, please contact us at:{' '}
          <a href="mailto:merplex@gmail.com" className="text-blue-600 underline">
            merplex@gmail.com
          </a>
        </p>
      </section>
    </div>
  )
}
