export default async function handler(req, res) {
  let kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return res.status(500).json({ error: "Missing KV environment variables. Please check Vercel settings." });
  }
  
  // Remove trailing slash if exists
  if (kvUrl.endsWith('/')) {
    kvUrl = kvUrl.slice(0, -1);
  }

  // GET Requests
  if (req.method === 'GET') {
    const action = req.query.action || 'getReservations';

    if (action === 'getSettings') {
      try {
        const response = await fetch(`${kvUrl}/get/tehit_settings_data`, {
          headers: { Authorization: `Bearer ${kvToken}` }
        });
        const data = await response.json();
        
        // Initial Default Settings
        let settings = {
          adminId: "admin",
          adminPassword: "project7672500197!",
          notice: "[studio_tehit 공지사항]\n- 최소 예약 시간은 2시간입니다.\n- 예약 신청 후 예약대기 상태가 되며, 관리자 안내에 따라 대관료 입금 시 예약 완료 처리됩니다.\n- 기준 인원: 1층/2층 단독 3명, 전체대관 5명 (추가 인원당 시간별 5,000원 추가)",
          inquiry: "https://instagram.com/studio_tehit",
          directions: "https://map.naver.com",
          price1f: 50000,
          price2f: 50000,
          priceAll: 90000,
          priceExtra: 5000
        };

        let needsInit = false;
        if (data && data.result) {
          try {
            const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
            settings = { ...settings, ...parsed };
          } catch(e) {
            needsInit = true;
          }
        } else {
          needsInit = true;
        }

        // Auto initialize settings in database if empty
        if (needsInit) {
          await fetch(`${kvUrl}/set/tehit_settings_data`, {
            method: 'POST',
            headers: { 
              Authorization: `Bearer ${kvToken}`, 
              'Content-Type': 'application/json' 
            },
            body: JSON.stringify(settings)
          });
        }

        return res.status(200).json({ settings });
      } catch (err) {
        return res.status(500).json({ error: "Failed to fetch settings from KV", details: err.message });
      }
    } else {
      // getReservations
      try {
        const response = await fetch(`${kvUrl}/get/tehit_reservations_data`, {
          headers: { Authorization: `Bearer ${kvToken}` }
        });
        const data = await response.json();
        
        let reservations = [];
        if (data && data.result) {
          try {
            reservations = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
          } catch(e) {
            reservations = data.result;
          }
        }
        return res.status(200).json({ reservations });
      } catch (err) {
        return res.status(500).json({ error: "Failed to fetch reservations from KV", details: err.message });
      }
    }
  }

  // POST Requests
  if (req.method === 'POST') {
    try {
      let incomingData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const action = incomingData.action;

      if (action === 'saveSettings') {
        const settingsToSave = incomingData.settings;
        if (!settingsToSave) return res.status(400).json({ error: "Settings data missing" });
        
        // Ensure admin credentials are kept if missing in save payload
        if (!settingsToSave.adminId) settingsToSave.adminId = "admin";
        if (!settingsToSave.adminPassword) settingsToSave.adminPassword = "project7672500197!";

        const saveResponse = await fetch(`${kvUrl}/set/tehit_settings_data`, {
          method: 'POST',
          headers: { 
            Authorization: `Bearer ${kvToken}`, 
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify(settingsToSave)
        });

        if (!saveResponse.ok) {
          const errText = await saveResponse.text();
          throw new Error("KV SET operation failed: " + errText);
        }
        return res.status(200).json({ success: true, message: "Settings saved successfully." });
      } 
      
      if (action === 'saveReservations') {
        const reservationsToSave = incomingData.reservations;
        if (!Array.isArray(reservationsToSave)) {
          return res.status(400).json({ error: "Invalid data format. Expected an array." });
        }

        // Server-side Double Validation for Overlaps
        const validReservations = [];
        for (const r of reservationsToSave) {
          const overlap = validReservations.find(ex => 
            ex.start_date === r.start_date && 
            ex.id !== r.id && 
            Math.max(r.start_hour, ex.start_hour) < Math.min(r.end_hour, ex.end_hour) && 
            (r.room === ex.room || r.room === '전체' || ex.room === '전체')
          );
          
          if (overlap) {
            return res.status(400).json({ 
              error: "중복된 대관 예약 시간이 존재합니다. (날짜: " + r.start_date + ", 층: " + r.room + ")",
              overlapDetails: r 
            });
          }
          validReservations.push(r);
        }

        const saveResponse = await fetch(`${kvUrl}/set/tehit_reservations_data`, {
          method: 'POST',
          headers: { 
            Authorization: `Bearer ${kvToken}`, 
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify(validReservations)
        });

        if (!saveResponse.ok) {
          const errText = await saveResponse.text();
          throw new Error("KV SET operation failed: " + errText);
        }
        return res.status(200).json({ success: true, message: "Reservations saved successfully." });
      }

      return res.status(400).json({ error: "Invalid action specified in POST request." });
    } catch (err) {
      console.error("POST Error:", err);
      return res.status(500).json({ error: "Failed to save to KV", details: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
