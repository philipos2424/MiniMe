const { supabase } = require('../../../packages/db/client'); // Adjust path as needed

/**
 * B2B Manifest Service
 * Manages the "Digital Storefront" for businesses in the B2B Network.
 */
const manifestService = {
  /**
   * Create or update a service in the business manifest.
   */
  async upsertService(businessId, serviceData) {
    const { service_name, description, min_price, max_price, currency, tags, availability_status } = serviceData;

    const { data, error } = await supabase
      .from('business_manifests')
      .upsert({
        business_id: businessId,
        service_name,
        description,
        min_price,
        max_price,
        currency: currency || 'ETB',
        tags: tags || [],
        availability_status: availability_status || 'available',
        last_updated: new Date().toISOString(),
      }, { onConflict: 'business_id, service_name' })
      .select()
      .single();

    if (error) throw new Error(`Manifest Upsert Error: ${error.message}`);
    return data;
  },

  /**
   * Get all services for a specific business.
   */
  async getManifest(businessId) {
    const { data, error } = await supabase
      .from('business_manifests')
      .select('*')
      .eq('business_id', businessId);

    if (error) throw new Error(`Manifest Fetch Error: ${error.message}`);
    return data;
  },

  /**
   * Remove a service from the manifest.
   */
  async removeService(businessId, serviceName) {
    const { error } = await supabase
      .from('business_manifests')
      .delete()
      .eq('business_id', businessId)
      .eq('service_name', serviceName);

    if (error) throw new Error(`Manifest Remove Error: ${error.message}`);
    return { success: true };
  },

  /**
   * Update agency level (Ghost/Agent/Partner).
   */
  async setAgencyLevel(businessId, level) {
    if (level < 1 || level > 3) throw new Error('Invalid agency level. Must be 1, 2, or 3.');

    const { error } = await supabase
      .from('businesses')
      .update({ b2b_agency_level: level })
      .eq('id', businessId);

    if (error) throw new Error(`Agency Level Update Error: ${error.message}`);
    return { success: true };
  }
};

module.exports = manifestService;
